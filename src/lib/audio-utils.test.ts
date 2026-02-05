import { describe, it, expect } from 'vitest';
import { freqToMidi, midiToNote, midiToAbc, detectChord } from './audio-utils';

describe('Audio Utilities', () => {
    describe('freqToMidi', () => {
        it('should correctly convert A440 to MIDI 69', () => {
            expect(freqToMidi(440)).toBe(69);
        });

        it('should correctly convert Middle C (261.63Hz) to MIDI 60', () => {
            expect(freqToMidi(261.63)).toBe(60);
        });
    });

    describe('midiToNote', () => {
        it('should convert 60 to C4', () => {
            expect(midiToNote(60)).toBe('C4');
        });

        it('should convert 69 to A4', () => {
            expect(midiToNote(69)).toBe('A4');
        });
    });

    describe('midiToAbc', () => {
        it('should convert Middle C (60) to C', () => {
            expect(midiToAbc(60)).toBe('C');
        });

        it('should convert C5 (72) to c', () => {
            expect(midiToAbc(72)).toBe('c');
        });

        it('should convert C3 (48) to C,', () => {
            expect(midiToAbc(48)).toBe('C,');
        });
    });

    describe('detectChord', () => {
        it('should detect C Major triad', () => {
            const notes = [60, 64, 67]; // C, E, G
            expect(detectChord(notes)).toBe('C Maj');
        });

        it('should detect A minor triad', () => {
            const notes = [57, 60, 64]; // A, C, E
            expect(detectChord(notes)).toBe('A min');
        });

        it('should return --- for empty notes', () => {
            expect(detectChord([])).toBe('---');
        });
    });
});
