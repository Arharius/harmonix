"use client";

import React, { useEffect, useRef } from 'react';
import abcjs from 'abcjs';

interface StaffRendererProps {
    abcNotation: string;
}

const StaffRenderer: React.FC<StaffRendererProps> = ({ abcNotation }) => {
    const staffRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (staffRef.current && typeof window !== 'undefined') {
            console.log("Rendering ABC Notation:", abcNotation);
            try {
                abcjs.renderAbc(staffRef.current, abcNotation, {
                    responsive: 'resize',
                    scale: 1.0,
                    add_classes: true,
                    staffwidth: 800,
                    wrap: {
                        preferredMeasuresPerLine: 4,
                        minSpacing: 1.5,
                        maxSpacing: 5
                    }
                });
            } catch (err) {
                console.error("ABCJS Rendering Error:", err);
            }
        }
    }, [abcNotation]);

    return (
        <div className="print-wrapper" style={{
            width: '100%',
            minHeight: '300px',
            backgroundColor: '#ffffff',
            padding: '30px',
            borderRadius: '12px',
            overflowX: 'auto',
            border: '2px solid var(--primary-glow)'
        }}>
            <div
                ref={staffRef}
                id="sheet-music-staff"
                style={{ width: '100%', color: 'black' }}
            ></div>
            <style jsx global>{`
        #sheet-music-staff svg {
          background: white !important;
        }
        #sheet-music-staff path {
          fill: black !important;
          stroke: black !important;
        }
        #sheet-music-staff text {
          fill: black !important;
        }
      `}</style>
        </div>
    );
};

export default StaffRenderer;
