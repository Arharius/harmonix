export const freqToMidi = (frequency: number): number => {
    return Math.round(12 * Math.log2(frequency / 440) + 69);
};

export const midiToNote = (midi: number): string => {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midi / 12) - 1;
    const name = notes[midi % 12];
    return `${name}${octave}`;
};

export const midiToAbc = (midi: any): string => {
    // Ultra-safe check for invalid inputs
    if (
        midi === null ||
        midi === undefined ||
        typeof midi !== 'number' ||
        isNaN(midi) ||
        !isFinite(midi)
    ) return "z";

    // Clamp to valid MIDI range 0-127
    const safeMidi = Math.max(0, Math.min(127, Math.round(midi)));
    const notes = ['C', '^C', 'D', '^D', 'E', 'F', '^F', 'G', '^G', 'A', '^A', 'B'];
    const noteIndex = safeMidi % 12;
    const octave = Math.floor(safeMidi / 12) - 1;
    const noteName = notes[noteIndex] || "C";

    if (octave === 4) return noteName;
    if (octave < 4) {
        let suffix = '';
        const diff = Math.max(0, Math.min(10, 4 - octave));
        for (let i = 0; i < diff; i++) suffix += ',';
        return noteName + suffix;
    } else {
        let prefix = noteName.toLowerCase();
        let suffix = '';
        const diff = Math.max(0, Math.min(10, octave - 5));
        for (let i = 0; i < diff; i++) suffix += "'";
        return (octave === 5) ? prefix : prefix + suffix;
    }
};

export const detectKey = (midiNotes: number[]): string => {
    if (midiNotes.length < 5) return "C";

    const chromas = midiNotes.map(m => m % 12);
    const majorIntervals = [0, 2, 4, 5, 7, 9, 11];

    let bestKey = "C";
    let maxMatch = -1;

    for (let root = 0; root < 12; root++) {
        const scale = majorIntervals.map(i => (root + i) % 12);
        const matches = chromas.filter(c => scale.includes(c)).length;

        if (matches > maxMatch) {
            maxMatch = matches;
            const nameMap = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
            bestKey = nameMap[root];
        }
    }
    return bestKey;
};

export const snapToScale = (midi: number, key: string): number => {
    const majorScaleOffsets: Record<string, number[]> = {
        'C': [0, 2, 4, 5, 7, 9, 11],
        'G': [0, 2, 4, 5, 7, 9, 11],
        'D': [0, 2, 4, 5, 7, 9, 11],
        'F': [0, 2, 4, 5, 7, 9, 11],
        'Bb': [0, 2, 4, 5, 7, 9, 11],
        'A': [0, 2, 4, 5, 7, 9, 11],
        'E': [0, 2, 4, 5, 7, 9, 11],
        'Eb': [0, 2, 4, 5, 7, 9, 11],
    };

    const rootMap: Record<string, number> = {
        'C': 0, 'Db': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'Gb': 6, 'G': 7, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11
    };

    const root = rootMap[key] || 0;
    const intervals = majorScaleOffsets[key] || majorScaleOffsets['C'];
    const scale = intervals.map(i => (root + i) % 12);

    const chroma = midi % 12;
    if (scale.includes(chroma)) return midi;

    let bestNote = midi;
    let minDiff = 13;
    for (const s of scale) {
        let diff = Math.abs(chroma - s);
        if (diff > 6) diff = 12 - diff;
        if (diff < minDiff) {
            minDiff = diff;
            bestNote = Math.floor(midi / 12) * 12 + s;
        }
    }
    return bestNote;
};

export const detectChord = (midiNotes: number[]): string => {
    if (midiNotes.length === 0) return "---";

    // Get unique notes in one octave (C=0, C#=1, etc.)
    const uniqueNotes = Array.from(new Set(midiNotes.map(m => m % 12))).sort((a, b) => a - b);

    if (uniqueNotes.length < 2) return "---";

    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    // Check for common triads
    for (let root = 0; root < 12; root++) {
        const major = [(root) % 12, (root + 4) % 12, (root + 7) % 12].sort((a, b) => a - b);
        const minor = [(root) % 12, (root + 3) % 12, (root + 7) % 12].sort((a, b) => a - b);

        const matches = (template: number[]) => template.every(note => uniqueNotes.includes(note));

        if (matches(major)) return `${noteNames[root]} Maj`;
        if (matches(minor)) return `${noteNames[root]} min`;
    }

    return "Complex";
};

import MidiWriter from 'midi-writer-js';

export const generateMidiData = (abcNotes: string[]): string => {
    const track = new MidiWriter.Track();
    track.setTempo(120);

    const notes = abcNotes.filter(n => n !== "|").map(abc => {
        // Map ABC to MidiWriter format
        const pitch = abc.replace(/[',]/g, '').replace('^', '#');
        // Handle octave markers
        let octave = 4;
        const commas = (abc.match(/,/g) || []).length;
        const ticks = (abc.match(/'/g) || []).length;
        octave = octave - commas + ticks;

        return `${pitch}${octave}`;
    });

    notes.forEach(note => {
        track.addEvent(new MidiWriter.NoteEvent({ pitch: [note], duration: '4' }));
    });

    const write = new MidiWriter.Writer(track);
    return write.dataUri();
};

export const formatAbcChord = (midiNotes: number[]): string => {
    if (midiNotes.length === 0) return "";
    if (midiNotes.length === 1) return midiToAbc(midiNotes[0]);

    // Format as [CEG]
    const notes = midiNotes.map(midiToAbc).join('');
    return `[${notes}]`;
};

export const generateAbcHeader = (title: string = "Harmonix Output", key: string = "C") => {
    return `X:1
T:${title}
M:4/4
L:1/4
Q:1/4=120
K:${key}
%%staves {V1 V2}
V:V1 name="Melody" nm="Mel."
V:V2 name="Harmony" nm="Har." clef=bass
`;
};
