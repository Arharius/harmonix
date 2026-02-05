"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { PitchDetector } from 'pitchy';
import { freqToMidi, midiToAbc, detectKey, snapToScale } from './audio-utils';

export const useAudioProcessor = () => {
    const [isRecording, setIsRecording] = useState(false);

    // UI States (synced from Buffers)
    const [melody, setMelody] = useState<string[]>([]);
    const [harmony, setHarmony] = useState<string[]>([]);

    const [detectedKey, setDetectedKey] = useState("C");
    const [currentPitch, setCurrentPitch] = useState<number | null>(null);

    // Audio Context & Stream
    const audioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    // LOGIC BUFFERS (The Source of Truth)
    // We update these at 60fps detected, and sync to UI at lower fps.
    const melodyBuffer = useRef<string[]>([]);
    const harmonyBuffer = useRef<string[]>([]);
    const liveMidiRef = useRef<number[]>([]); // For key detection

    // Sync UI Interval Ref
    const uiSyncInterval = useRef<NodeJS.Timeout | null>(null);

    // Audio Logic State (Closure variables are fine, but detection state needs persistence)
    // We keep these in Refs to be accessible if we break out logic, 
    // but local let variables in startRecording are cleaner if the loop is self-contained.
    // For now, we keep the loop self-contained.

    // ------------------------------------------------------------------------
    // STATIC ANALYSIS (File Upload)
    // ------------------------------------------------------------------------
    // Function to quantize raw MIDI data into a strict rhythmic grid
    const quantizeMelody = (
        rawNotes: (number | null)[],
        sampleRate: number,
        sliceSize: number,
        key: string,
        qValue: number, // 4, 8, or 16
        sensitivity: number
    ) => {
        const secondsPerGrid = 2.0 / qValue;
        const samplesPerGrid = sampleRate * secondsPerGrid;
        const slicesPerGrid = Math.max(1, Math.round(samplesPerGrid / sliceSize));

        const gridNotes: (number | null)[] = [];

        // 1. Bucket raw notes into grid slots
        for (let i = 0; i < rawNotes.length; i += slicesPerGrid) {
            const chunk = rawNotes.slice(i, i + slicesPerGrid);
            const counts: Record<number, number> = {};
            let nullCount = 0;

            chunk.forEach(n => {
                if (n === null) nullCount++;
                else counts[n] = (counts[n] || 0) + 1;
            });

            // Sensitivity Logic
            const silenceThreshold = 0.2 + (sensitivity * 0.6); // Range 0.2 to 0.8
            const nullRatio = nullCount / chunk.length;

            if (nullRatio > silenceThreshold) {
                gridNotes.push(null);
            } else {
                let bestNote = -1;
                let maxCount = -1;
                for (const [note, count] of Object.entries(counts)) {
                    if (count > maxCount) {
                        maxCount = count;
                        bestNote = Number(note);
                    }
                }

                if (bestNote !== -1) {
                    const snapped = snapToScale(bestNote, key);
                    gridNotes.push(snapped);
                } else {
                    gridNotes.push(null);
                }
            }
        }

        // 1.5. GAP FILLING
        for (let i = 1; i < gridNotes.length - 1; i++) {
            const prev = gridNotes[i - 1];
            const curr = gridNotes[i];
            const next = gridNotes[i + 1];

            if (curr === null && prev !== null && next !== null) {
                if (prev === next) {
                    gridNotes[i] = prev;
                } else {
                    gridNotes[i] = prev;
                }
            }
        }

        // 1.6. SMART TAIL EXTENSION
        let i = 0;
        while (i < gridNotes.length) {
            if (gridNotes[i] !== null) {
                const pitch = gridNotes[i];
                let run = 0;
                let j = i;
                while (j < gridNotes.length && gridNotes[j] === pitch) {
                    run++;
                    j++;
                }

                if (j < gridNotes.length && gridNotes[j] === null) {
                    if (run === 3 || run === 7 || run === 15) {
                        gridNotes[j] = pitch; // Extend tail
                    }
                }
                i = j;
            } else {
                i++;
            }
        }

        // 2. Generate ABC from Grid
        const melRes: string[] = [];
        const harRes: string[] = [];
        let lastNote: number | null = null;
        let duration = 0;

        const getDurStr = (d: number) => {
            if (qValue === 8) return d === 1 ? "" : d.toString();
            if (qValue === 16) {
                if (d % 2 === 0) {
                    const eights = d / 2;
                    return eights === 1 ? "" : eights.toString();
                } else {
                    return d === 1 ? "/2" : `${d}/2`;
                }
            }
            if (qValue === 4) return (d * 2).toString();
            return d.toString();
        };

        const pushNote = (note: number | null, dur: number) => {
            if (dur === 0) return;
            const durStr = getDurStr(dur);

            if (note !== null) {
                const abc = midiToAbc(note);
                const safeAbc = (abc && abc !== "undefined") ? abc : "z";
                melRes.push(safeAbc + durStr);

                let hMidi = note - 12;
                while (hMidi > 55) hMidi -= 12;
                while (hMidi < 36) hMidi += 12;
                const hAbc = midiToAbc(hMidi);
                const safeHAbc = (hAbc && hAbc !== "undefined") ? hAbc : "z";
                harRes.push(safeHAbc + durStr);
            } else {
                melRes.push("z" + durStr);
                harRes.push("z" + durStr);
            }
        };

        const barLimit = qValue;

        for (let i = 0; i < gridNotes.length; i++) {
            if (i > 0 && i % barLimit === 0) {
                if (duration > 0) {
                    pushNote(lastNote, duration);
                    duration = 0;
                    lastNote = null;
                }
                melRes.push("|");
                harRes.push("|");
            }

            const note = gridNotes[i];

            if (duration === 0) {
                lastNote = note;
                duration = 1;
            } else if (note === lastNote) {
                duration++;
            } else {
                pushNote(lastNote, duration);
                lastNote = note;
                duration = 1;
            }
        }
        if (duration > 0) {
            pushNote(lastNote, duration);
        }

        return { melody: melRes, harmony: harRes };
    };

    const analyzeFile = useCallback(async (file: File, qValue: number = 8, sensitivity: number = 0.5) => {
        try {
            setMelody([]);
            setHarmony([]);

            const arrayBuffer = await file.arrayBuffer();
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

            const sampleRate = audioBuffer.sampleRate;
            const channelData = audioBuffer.getChannelData(0);
            const detector = PitchDetector.forFloat32Array(2048);
            const input = new Float32Array(detector.inputLength);

            const sliceSize = Math.floor(sampleRate * 0.03);
            const baseClarity = 0.95 - (sensitivity * 0.35);

            const rawMidi: (number | null)[] = [];
            for (let i = 0; i < channelData.length - detector.inputLength; i += sliceSize) {
                input.set(channelData.subarray(i, i + detector.inputLength));
                const [pitch, clarity] = detector.findPitch(input, sampleRate);

                if (pitch < 85 || pitch > 1200) {
                    rawMidi.push(null);
                    continue;
                }

                const midi = (clarity > baseClarity) ? freqToMidi(pitch) : null;
                let correctedMidi = midi;
                if (correctedMidi !== null) {
                    while (correctedMidi < 48) correctedMidi += 12;
                    while (correctedMidi > 84) correctedMidi -= 12;
                }
                rawMidi.push(correctedMidi);
            }

            const validNotes = rawMidi.filter(m => m !== null) as number[];
            const autoKey = validNotes.length > 5 ? detectKey(validNotes) : "C";
            setDetectedKey(autoKey);

            const result = quantizeMelody(rawMidi, sampleRate, sliceSize, autoKey, qValue, sensitivity);
            setMelody(result.melody);
            setHarmony(result.harmony);

            ctx.close();
        } catch (err) {
            console.error("Error analyzing file:", err);
            alert("Ошибка при анализе файла: " + err);
        }
    }, []);


    // ------------------------------------------------------------------------
    // REAL-TIME RECORDING (Buffer-Synced Architecture)
    // ------------------------------------------------------------------------
    const startRecording = useCallback(async (qValue: number = 8, sensitivity: number = 0.5) => {
        try {
            // Reset Buffers
            melodyBuffer.current = [];
            harmonyBuffer.current = [];
            liveMidiRef.current = [];

            // Clean Re-start checks
            if (uiSyncInterval.current) clearInterval(uiSyncInterval.current);
            setMelody([]);
            setHarmony([]);

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioContext = new AudioContextClass();
            audioContextRef.current = audioContext;

            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            analyserRef.current = analyser;

            const detector = PitchDetector.forFloat32Array(analyser.fftSize);
            const input = new Float32Array(detector.inputLength);

            setIsRecording(true);

            // LOGIC STATE
            let lastMidi: number | null = null;
            let stableFrames = 0;
            let isContinuous = false;
            let gridUnitsFilled = 0;

            // Slightly reduced threshold for better responsiveness
            // Sens 0.5 -> 0.775 clarity threshold (Good for voice)
            const baseClarity = 0.95 - (sensitivity * 0.35);

            // START AUDIO LOOP (60fps)
            const updatePitch = async () => {
                try {
                    if (audioContext.state === 'suspended') await audioContext.resume();

                    analyser.getFloatTimeDomainData(input);
                    const [pitch, clarity] = detector.findPitch(input, audioContext.sampleRate);

                    // Silence / Noise Filter
                    if (pitch < 85 || pitch > 1200 || clarity < baseClarity) {
                        setCurrentPitch(null);
                        lastMidi = null;
                        stableFrames = 0;
                        isContinuous = false;
                    } else {
                        // DETECTED NOTE
                        setCurrentPitch(pitch);
                        let midi = freqToMidi(pitch);

                        // Range Lock
                        while (midi < 48) midi += 12;
                        while (midi > 84) midi -= 12;

                        if (midi === lastMidi) {
                            stableFrames++;
                            // Debounce (Buffer of 6 frames ~ 100ms)
                            if (stableFrames === 6) {
                                const abc = midiToAbc(midi);
                                let hMidi = midi - 12;
                                while (hMidi > 55) hMidi -= 12;
                                while (hMidi < 36) hMidi += 12;
                                const hAbc = midiToAbc(hMidi);

                                // ------------------------------------
                                // BUFFER MUTATION LOGIC (Fast & Safe)
                                // ------------------------------------
                                const mel = melodyBuffer.current;
                                const har = harmonyBuffer.current;
                                const lastIdx = mel.length - 1;
                                const lastItem = mel[lastIdx];

                                let shouldMerge = false;
                                if (isContinuous && lastItem && lastItem !== "|" && lastItem.startsWith(abc)) {
                                    shouldMerge = true;
                                }

                                // Calculate Bar Sync Logic FIRST
                                // Each event (Push or Extend) consumes 1 detection unit of time
                                // We simplify this to "1 event = 1 unit" for now.
                                gridUnitsFilled++;
                                const insertBar = (gridUnitsFilled >= qValue);
                                if (insertBar) gridUnitsFilled = 0;

                                if (shouldMerge) {
                                    // MODIFY last items
                                    const match = lastItem.match(/\d+$/);
                                    let dur = match ? parseInt(match[0]) : 1;
                                    dur++;

                                    mel[lastIdx] = abc + dur;

                                    const hLast = har[lastIdx];
                                    const hMatch = hLast.match(/\d+$/);
                                    let hDur = hMatch ? parseInt(hMatch[0]) : 1;
                                    hDur++;
                                    har[lastIdx] = hAbc + hDur;
                                } else {
                                    // PUSH new items
                                    liveMidiRef.current.push(midi);
                                    mel.push(abc);
                                    har.push(hAbc);
                                }

                                if (insertBar) {
                                    mel.push("|");
                                    har.push("|");
                                }

                                isContinuous = true;
                                stableFrames = 0;
                            }
                        } else {
                            // Changed Note detected (reset)
                            lastMidi = midi;
                            stableFrames = 0;
                            isContinuous = false;
                        }
                    }

                    animationFrameRef.current = requestAnimationFrame(updatePitch);
                } catch (e) {
                    console.error("Audio Loop Error:", e);
                    animationFrameRef.current = requestAnimationFrame(updatePitch);
                }
            };

            updatePitch();

            // START UI SYNC LOOP (10fps / 100ms)
            // This prevents "Twitching" by batching updates.
            uiSyncInterval.current = setInterval(() => {
                // Determine if we need to update
                // Simple diff check: length comparison is usually enough for "additions"
                // But merging changes content length (char count), not array length.
                // So we basically ALWAYS update if recording? 
                // Or we can check a dirty flag.
                // For now, unconditional update at 10fps is cheap for React.

                if (melodyBuffer.current.length > 0) {
                    // Creating new array references forces re-render
                    setMelody([...melodyBuffer.current]);
                    setHarmony([...harmonyBuffer.current]);
                }
            }, 100);

        } catch (err) {
            console.error("Error accessing microphone:", err);
            alert("Ошибка доступа к микрофону");
        }
    }, []);

    const stopRecording = useCallback(() => {
        setIsRecording(false);
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (uiSyncInterval.current) clearInterval(uiSyncInterval.current);

        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        if (audioContextRef.current) audioContextRef.current.close();

        if (liveMidiRef.current.length > 5) {
            setDetectedKey(detectKey(liveMidiRef.current));
        }
    }, []);

    const clearNotes = () => {
        melodyBuffer.current = [];
        harmonyBuffer.current = [];
        setMelody([]);
        setHarmony([]);
    };

    return {
        isRecording,
        startRecording,
        stopRecording,
        analyzeFile,
        melody,
        harmony,
        detectedKey,
        currentPitch,
        clearNotes
    };
};
