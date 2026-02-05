"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { PitchDetector } from 'pitchy';
import { freqToMidi, midiToAbc, detectKey, snapToScale } from './audio-utils';

export const useAudioProcessor = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [melody, setMelody] = useState<string[]>([]);
    const [harmony, setHarmony] = useState<string[]>([]);
    const [detectedKey, setDetectedKey] = useState("C");
    const [currentPitch, setCurrentPitch] = useState<number | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const liveMidiRef = useRef<number[]>([]);

    // Function to quantize raw MIDI data into a strict rhythmic grid
    // Now supports dynamic grid steps (4, 8, 16) and sensitivity
    const quantizeMelody = (
        rawNotes: (number | null)[],
        sampleRate: number,
        sliceSize: number,
        key: string,
        qValue: number, // 4, 8, or 16
        sensitivity: number // 0.0 to 1.0 (Higher = captures more notes, Lower = more rests)
    ) => {
        // Calculate samples per grid unit
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

            // Sensitivity Logic Refined:
            // "Silence Threshold": The % of NULLS allowed in a chunk.
            // If there are MORE nulls than this threshold, the whole chunk is REST.

            // Sens 1.0 (High Sens) -> We want to captures notes even if they are faint/short.
            // So we allow LOTS of nulls. Threshold should be HIGH (e.g. 0.8). 
            // If 70% is null, that's fine, we keep the 30% note.

            // Sens 0.0 (Low Sens/Strict) -> We only want pure notes. 
            // We allow VERY FEW nulls. Threshold should be LOW (e.g. 0.2).
            // If 30% is null, that's too much noise! Kill it.

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

        // 1.5. GAP FILLING (Legato Smoothing)
        // Check for short gaps (nulls) between notes and fill them
        for (let i = 1; i < gridNotes.length - 1; i++) {
            const prev = gridNotes[i - 1];
            const curr = gridNotes[i];
            const next = gridNotes[i + 1];

            if (curr === null && prev !== null && next !== null) {
                // If gap between two notes
                // 1. If Same Note A _ A -> A A A
                if (prev === next) {
                    gridNotes[i] = prev;
                }
                // 2. If Different Notes A _ B -> A A B (Extend prev)
                // This makes it feel more connected
                else {
                    gridNotes[i] = prev;
                }
            }
        }

        // 1.6. SMART TAIL EXTENSION (Reduce "Staccato" Rests)
        // If Note(A) -> Rest -> Note(B), keep rest.
        // If Note(A) -> Rest -> Rest, maybe extend A?
        // Specifically: If we have [A, A, A, null] (3 units + 1 rest), likely intended as A(4).
        // Iterate and look for patterns.

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

                // Found run of length 'run'. Check next item.
                // If next is null, and run is "almost" a beat...
                // e.g. run=3 (3/16), next=null. Extend to 4.
                // e.g. run=7 (7/16), next=null. Extend to 8.
                if (j < gridNotes.length && gridNotes[j] === null) {
                    // Only extend if it completes a "nice" number (4, 8)
                    if (run === 3 || run === 7 || run === 15) {
                        gridNotes[j] = pitch; // Extend tail
                    }
                }
                i = j;
            } else {
                i++;
            }
        }

        // 2. Generate ABC from Grid with strict Bar Splitting
        const melRes: string[] = [];
        const harRes: string[] = [];
        let lastNote: number | null = null;
        let duration = 0;

        // Helper to format duration based on Q value
        const getDurStr = (d: number) => {
            // d is number of grid units.
            // L:1/8 default in header.

            if (qValue === 8) {
                return d === 1 ? "" : d.toString();
            }
            if (qValue === 16) {
                // 1 unit = 1/16 = "/2"
                // 2 units = 1/8 = ""
                // 3 units = 3/16 = "3/2"
                // 4 units = 1/4 = "2"
                if (d % 2 === 0) {
                    const eights = d / 2;
                    return eights === 1 ? "" : eights.toString();
                } else {
                    return d === 1 ? "/2" : `${d}/2`;
                }
            }
            if (qValue === 4) {
                // 1 unit = 1/4 = "2" (since base is 1/8)
                return (d * 2).toString();
            }
            return d.toString();
        };

        const pushNote = (note: number | null, dur: number) => {
            if (dur === 0) return;
            const durStr = getDurStr(dur);

            if (note !== null) {
                const abc = midiToAbc(note);
                const safeAbc = (abc && abc !== "undefined") ? abc : "z";
                melRes.push(safeAbc + durStr);

                // Harmony logic
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

    const startRecording = useCallback(async (qValue: number = 8, sensitivity: number = 0.5) => {
        try {
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

            let lastMidi: number | null = null;
            let measureCount = 0;
            let stableFrames = 0;
            liveMidiRef.current = [];

            // Dynamic Thresholds from Analysis Logic
            const baseClarity = 0.95 - (sensitivity * 0.35);

            const updatePitch = async () => {
                if (audioContext.state === 'suspended') {
                    await audioContext.resume();
                }

                analyser.getFloatTimeDomainData(input);
                const [pitch, clarity] = detector.findPitch(input, audioContext.sampleRate);

                // 1. FILTER: Ignore frequencies below 85Hz
                if (pitch < 85 || pitch > 1200) {
                    setCurrentPitch(null);
                    lastMidi = null;
                    stableFrames = 0;
                    animationFrameRef.current = requestAnimationFrame(updatePitch);
                    return;
                }

                if (clarity > baseClarity) {
                    setCurrentPitch(pitch);
                    let midi = freqToMidi(pitch);

                    // 2. RANGE LOCK: Force into Vocal Range (C3 - C6)
                    while (midi < 48) midi += 12;
                    while (midi > 84) midi -= 12;

                    if (midi === lastMidi) {
                        stableFrames++;
                        // Require MORE stability (approx 200ms at 60fps) to avoid jitter
                        if (stableFrames === 12) {
                            const abc = midiToAbc(midi);

                            // SMART MERGE LOGIC:
                            // Instead of pushing [C, C, C], extend previous note [C3]
                            // This stops the UI from "twitching" (layout rebuilds)

                            setMelody(prev => {
                                const lastIdx = prev.length - 1;
                                const lastItem = prev[lastIdx]; // e.g. "C" or "C2" or "|"

                                // Check if last item is same note
                                if (lastItem && lastItem !== "|" && lastItem.startsWith(abc)) {
                                    // Extract current duration number
                                    const match = lastItem.match(/\d+$/);
                                    let dur = match ? parseInt(match[0]) : 1;
                                    dur++;

                                    // Replace last item with extended duration
                                    const newPrev = [...prev];
                                    newPrev[lastIdx] = abc + dur;
                                    return newPrev;
                                } else {
                                    // New note, push it
                                    liveMidiRef.current.push(midi);
                                    const next = [...prev, abc];
                                    measureCount++;
                                    if (measureCount % qValue === 0) next.push("|");
                                    return next;
                                }
                            });

                            // Real-time harmony (same merge logic)
                            setHarmony(prev => {
                                let hMidi = midi - 12;
                                while (hMidi > 55) hMidi -= 12;
                                while (hMidi < 36) hMidi += 12;
                                const hAbc = midiToAbc(hMidi);

                                const lastIdx = prev.length - 1;
                                const lastItem = prev[lastIdx];

                                if (lastItem && lastItem !== "|" && lastItem.startsWith(hAbc)) {
                                    const match = lastItem.match(/\d+$/);
                                    let dur = match ? parseInt(match[0]) : 1;
                                    dur++;
                                    const newPrev = [...prev];
                                    newPrev[lastIdx] = hAbc + dur;
                                    return newPrev;
                                } else {
                                    const next = [...prev, hAbc];
                                    if (measureCount % qValue === 0) next.push("|");
                                    return next;
                                }
                            });

                            // Reset frames but keep lastMidi so we continue extending
                            stableFrames = 0;
                        }
                    } else {
                        // New note detected, wait for it to stabilize
                        lastMidi = midi;
                        stableFrames = 0;
                    }
                } else {
                    setCurrentPitch(null);
                    lastMidi = null;
                    stableFrames = 0;
                }

                animationFrameRef.current = requestAnimationFrame(updatePitch);
            };

            updatePitch();
        } catch (err) {
            console.error("Error accessing microphone:", err);
            alert("Ошибка доступа к микрофону");
        }
    }, []);

    const stopRecording = useCallback(() => {
        setIsRecording(false);
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        if (audioContextRef.current) audioContextRef.current.close();

        if (liveMidiRef.current.length > 5) {
            setDetectedKey(detectKey(liveMidiRef.current));
        }
    }, []);

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

            // Small slice for raw detection (approx 30ms)
            const sliceSize = Math.floor(sampleRate * 0.03);

            // 1. Raw Detection Pass
            // Dynamic Clarity Threshold based on Sensitivity
            // Sens 0.0 (Strict) -> Clarity 0.95
            // Sens 0.5 (Default) -> Clarity 0.825
            // Sens 1.0 (Loose) -> Clarity 0.60 (Captures 35% more noise space)
            const baseClarity = 0.95 - (sensitivity * 0.35);

            const rawMidi: (number | null)[] = [];
            for (let i = 0; i < channelData.length - detector.inputLength; i += sliceSize) {
                input.set(channelData.subarray(i, i + detector.inputLength));
                const [pitch, clarity] = detector.findPitch(input, sampleRate);

                // Use dynamic threshold instead of hardcoded 0.85
                // 1. FILTER: Ignore frequencies below 85Hz (Low E on scale) to kill rumble
                if (pitch < 85 || pitch > 1200) {
                    rawMidi.push(null);
                    continue;
                }

                const midi = (clarity > baseClarity) ? freqToMidi(pitch) : null;

                // 2. RANGE LOCK: Force notes into Vocal Range (C3 - C6)
                // If we detect extremely low notes (e.g. A0, A1), it's likely a sub-harmonic misdetection.
                // Shift them up to C3 (Midi 48) minimum.
                let correctedMidi = midi;
                if (correctedMidi !== null) {
                    while (correctedMidi < 48) { // Below C3
                        correctedMidi += 12; // Shift Octave Up
                    }
                    while (correctedMidi > 84) { // Above C6
                        correctedMidi -= 12; // Shift Octave Down
                    }
                }

                rawMidi.push(correctedMidi);
            }

            const validNotes = rawMidi.filter(m => m !== null) as number[];
            const autoKey = validNotes.length > 5 ? detectKey(validNotes) : "C";
            setDetectedKey(autoKey);

            // Pass user settings to quantizer
            const result = quantizeMelody(rawMidi, sampleRate, sliceSize, autoKey, qValue, sensitivity);

            setMelody(result.melody);
            setHarmony(result.harmony);

            ctx.close();
        } catch (err) {
            console.error("Error analyzing file:", err);
            alert("Ошибка при анализе файла: " + err);
        }
    }, []);

    const clearNotes = () => {
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
