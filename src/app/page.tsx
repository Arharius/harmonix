"use client";

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Mic, Square, Trash2, Printer, Upload, Music, Volume2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAudioProcessor } from '@/lib/useAudioProcessor';
import { detectChord, generateMidiData } from '@/lib/audio-utils';

// Dynamic import for StaffRenderer as it uses browser APIs via abcjs
const StaffRenderer = dynamic(() => import('@/components/StaffRenderer'), {
  ssr: false,
  loading: () => <div className="p-4 text-center text-gray-500">Загрузка рендера...</div>
});

export default function Home() {
  const {
    isRecording,
    startRecording,
    stopRecording,
    analyzeFile,
    melody,
    harmony,
    detectedKey,
    currentPitch,
    clearNotes
  } = useAudioProcessor();

  const [title, setTitle] = useState("Melody");
  const [keySig, setKeySig] = useState("C");

  // New State for Controls
  const [qValue, setQValue] = useState(8); // Default 1/8th
  const [sensitivity, setSensitivity] = useState(0.5); // Default mid

  // Automatically update key signature when a new key is detected
  React.useEffect(() => {
    if (detectedKey) {
      setKeySig(detectedKey);
    }
  }, [detectedKey]);

  // Simple harmony/key detection based on notes
  const detectedHarmony = useMemo(() => {
    if (melody.length === 0) return "---";
    const lastNotes = melody
      .filter(n => n !== "|")
      .slice(-4)
      .map(abc => {
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        // Remove accidental markers, octave markers, AND duration numbers/slashes
        const base = abc.replace(/[',^]/g, '').replace(/[0-9\/]/g, '').toUpperCase();
        return notes.indexOf(base);
      })
      .filter(n => n !== -1);

    return detectChord(lastNotes);
  }, [melody]);

  const abcNotation = useMemo(() => {
    const melBody = melody.length > 0 ? melody.join(' ') : "z4";
    const harBody = harmony.length > 0 ? harmony.join(' ') : "z4";

    return `X:1
T:${title}
M:4/4
L:1/8
Q:1/4=120
K:${keySig}
V:V1 name="Melody"
${melBody}
V:V2 name="Harmony" clef=bass
${harBody}`;
  }, [melody, harmony, title, keySig]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Pass the current SETTINGS to the analyzer
      analyzeFile(file, qValue, sensitivity);
    }
  };

  const handleExportMidi = () => {
    if (melody.length === 0) {
      alert("Сначала запишите какую-нибудь мелодию!");
      return;
    }
    const dataUri = generateMidiData(melody);
    const link = document.createElement('a');
    link.href = dataUri;
    link.download = `${title || 'composition'}.mid`;
    link.click();
  };


  return (
    <main className="container">
      {/* Header */}
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-between items-center mb-12 no-print"
      >
        <div className="flex items-center gap-4">
          <div style={{
            width: '48px', height: '48px', backgroundColor: 'var(--primary)',
            borderRadius: '12px', display: 'flex', alignItems: 'center',
            justifyContent: 'center', boxShadow: '0 0 20px var(--primary-glow)'
          }}>
            <Music color="white" size={28} />
          </div>
          <div>
            <h1 className="text-gradient" style={{ fontSize: '1.5rem', marginBottom: '0' }}>HARMONIX</h1>
            <p className="label-small" style={{ marginBottom: '0', color: '#94a3b8' }}>Audio to Score</p>
          </div>
        </div>

        <div className="flex gap-6" style={{ color: '#64748b', fontSize: '0.8rem', fontWeight: 600 }}>
          <span className="flex items-center gap-2"><div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} /> LIVE SYNC</span>
          <span className="flex items-center gap-2"><div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)' }} /> HD READY</span>
        </div>
      </motion.div>

      {/* Main Grid */}
      <div className="grid grid-cols-layout gap-8">

        {/* Sidebar Controls */}
        <div className="flex flex-col gap-6 no-print">
          <section className="glass-panel flex flex-col gap-6">
            <h2 className="flex items-center gap-2" style={{ fontSize: '1.1rem' }}>
              <Volume2 size={20} color="var(--primary)" /> Управление
            </h2>

            <div className="flex flex-col gap-4">
              {/* Controls for Accuracy */}
              <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)' }}>
                <label className="label-small" style={{ marginBottom: '0.5rem', display: 'block' }}>Настройки точности</label>

                <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label className="label-small" style={{ fontSize: '0.6rem' }}>Ритм (Сетка)</label>
                    <select
                      value={qValue}
                      onChange={(e) => setQValue(Number(e.target.value))}
                      className="input-field"
                      style={{ padding: '0.5rem', fontSize: '0.8rem' }}
                    >
                      <option value={4}>1/4 (Марш)</option>
                      <option value={8}>1/8 (Поп/Рок)</option>
                      <option value={16}>1/16 (Джаз/Вокал)</option>
                    </select>
                  </div>
                  <div>
                    <label className="label-small" style={{ fontSize: '0.6rem' }}>Чувствительность</label>
                    <input
                      type="range"
                      min="0" max="1" step="0.1"
                      value={sensitivity}
                      onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--primary)', height: '38px' }}
                      title={`Sens: ${sensitivity}`}
                    />
                  </div>
                </div>
              </div>

              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="label-small">Название</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="input-field"
                    placeholder="Название..."
                  />
                </div>
                <div>
                  <label className="label-small">Тональность</label>
                  <select
                    value={keySig}
                    onChange={(e) => setKeySig(e.target.value)}
                    className="input-field"
                    style={{ appearance: 'none', cursor: 'pointer' }}
                  >
                    <option value="C">C Major</option>
                    <option value="G">G Major</option>
                    <option value="F">F Major</option>
                    <option value="D">D Major</option>
                    <option value="Bb">Bb Major</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3">
                {!isRecording ? (
                  <button onClick={() => startRecording(qValue, sensitivity)} className="btn btn-primary" style={{ flex: 2 }}>
                    <Mic size={20} /> Запись
                  </button>
                ) : (
                  <button onClick={stopRecording} className="btn btn-danger" style={{ flex: 2 }}>
                    <Square size={20} /> Стоп
                  </button>
                )}
                <button
                  onClick={() => {
                    try {
                      console.log("Opening print dialog...");
                      window.print();
                    } catch (e) {
                      alert("Ошибка печати: " + e);
                      console.error(e);
                    }
                  }}
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  title="Печать партитуры"
                >
                  <Printer size={18} />
                </button>
              </div>

              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <button onClick={clearNotes} className="btn btn-ghost">
                  <Trash2 size={18} /> Сброс
                </button>
                <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
                  <Upload size={18} /> Файл
                  <input type="file" style={{ display: 'none' }} onChange={handleFileUpload} accept="audio/*" />
                </label>
              </div>

              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <button onClick={handleExportMidi} className="btn btn-ghost" style={{ borderColor: 'var(--primary-glow)' }}>
                  <Music size={18} /> MIDI
                </button>
                <button onClick={() => window.print()} className="btn btn-ghost">
                  <Printer size={18} /> Печать
                </button>
              </div>
            </div>
          </section>

          {/* Recording Visualizer */}
          <AnimatePresence>
            {isRecording && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="glass-panel flex flex-col items-center justify-center gap-4 text-center"
              >
                <div style={{ position: 'relative', width: '64px', height: '64px' }}>
                  <div style={{
                    position: 'absolute', width: '100%', height: '100%',
                    border: '4px solid var(--primary)', borderRadius: '50%',
                    opacity: 0.2, animation: 'pulse-custom 1.5s infinite'
                  }} />
                  <div style={{
                    width: '100%', height: '100%', background: 'var(--primary-glow)',
                    borderRadius: '50%', display: 'flex', alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Volume2 color="var(--primary)" />
                  </div>
                </div>
                <div>
                  <p style={{ color: 'var(--primary)', fontWeight: 700 }} className="animate-pulse">СЛУШАЮ...</p>
                  {currentPitch && (
                    <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                      {Math.round(currentPitch)} HZ
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Notation Output */}
        <div className="flex flex-col gap-6">
          <div className="flex justify-between items-center no-print">
            <h2 style={{ fontSize: '1.25rem' }}>Нотный стан</h2>
            <button onClick={() => window.print()} className="btn btn-ghost" style={{ padding: '0.5rem 1rem' }}>
              <Printer size={16} /> Печать
            </button>
          </div>

          <StaffRenderer abcNotation={abcNotation} />

          <div className="stats-grid no-print">
            <div className="glass-panel">
              <label className="label-small">Ноты</label>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                <span style={{ fontSize: '2.5rem', fontWeight: 800 }}>{melody.length}</span>
                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>обнаружено</span>
              </div>
            </div>
            <div className="glass-panel">
              <label className="label-small">Тональность</label>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                <span style={{ fontSize: '2.5rem', fontWeight: 800 }}>{detectedHarmony}</span>
                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>AUTO</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
