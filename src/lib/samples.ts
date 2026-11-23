import type { Part } from 'firebase/ai';
import type { Mode } from '../types';
import { toJpegPart } from './vision';

// Fictional sample "photos" drawn on a canvas so anyone can try every mode without a camera.

type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;

function lines(c: CanvasRenderingContext2D, text: string[], x: number, y: number, size: number, gap = 1.35, font = 'Georgia, serif') {
  c.font = `${size}px ${font}`;
  text.forEach((t, i) => c.fillText(t, x, y + i * size * gap));
}

const medicine: Draw = (c, w, h) => {
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#6b4a2b');
  g.addColorStop(1, '#3d2816');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#e9b86a';
  c.fillRect(w * 0.18, h * 0.04, w * 0.64, h * 0.92);
  c.fillStyle = '#fffdf6';
  c.fillRect(w * 0.22, h * 0.22, w * 0.56, h * 0.6);
  c.fillStyle = '#123';
  c.font = 'bold 30px Arial';
  c.fillText('CITYCARE PHARMACY', w * 0.25, h * 0.27);
  c.fillStyle = '#222';
  lines(c, ['Rx# 4471902      Dr. A. Mensah', 'Patient: JORDAN LEE'], w * 0.25, h * 0.31, 22, 1.4, 'Arial');
  c.font = 'bold 44px Arial';
  c.fillText('LISINOPRIL 10 MG', w * 0.25, h * 0.41);
  c.font = '26px Arial';
  c.fillText('30 TABLETS', w * 0.25, h * 0.45);
  c.font = 'bold 30px Arial';
  lines(c, ['TAKE 1 TABLET BY MOUTH', 'ONCE DAILY IN THE MORNING'], w * 0.25, h * 0.52, 30, 1.3, 'Arial');
  c.fillStyle = '#b00020';
  c.fillRect(w * 0.25, h * 0.6, w * 0.5, h * 0.07);
  c.fillStyle = '#fff';
  c.font = 'bold 22px Arial';
  lines(c, ['MAY CAUSE DIZZINESS.', 'DO NOT USE IF PREGNANT.'], w * 0.27, h * 0.627, 22, 1.25, 'Arial');
  c.fillStyle = '#222';
  c.font = '24px Arial';
  lines(c, ['Filled: 08/14/2026', 'Discard after: 08/14/2027', 'Refills: 2'], w * 0.25, h * 0.72, 24, 1.3, 'Arial');
};

const letter: Draw = (c, w, h) => {
  c.fillStyle = '#c8c2b6';
  c.fillRect(0, 0, w, h);
  c.save();
  c.translate(w * 0.5, h * 0.5);
  c.rotate(-0.025);
  c.fillStyle = '#fbfaf6';
  c.fillRect(-w * 0.42, -h * 0.46, w * 0.84, h * 0.92);
  c.fillStyle = '#1d3557';
  c.font = 'bold 34px Arial';
  c.fillText('Riverside Water & Power', -w * 0.37, -h * 0.4);
  c.fillStyle = '#222';
  lines(
    c,
    [
      'November 12, 2026',
      '',
      'FINAL NOTICE: PAST DUE BALANCE',
      '',
      'Dear Customer,',
      '',
      'Your account is past due. The amount owed is',
      '$186.40. To avoid disconnection of service,',
      'payment must be received by December 1, 2026.',
      '',
      'If you cannot pay in full, call (555) 010-2299',
      'to set up a payment plan. Assistance programs',
      'are available for qualifying households.',
      '',
      'Sincerely,',
      'Customer Accounts',
    ],
    -w * 0.37,
    -h * 0.32,
    25,
  );
  c.restore();
};

const menu: Draw = (c, w, h) => {
  c.fillStyle = '#1e1a17';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#efe6d2';
  c.fillRect(w * 0.08, h * 0.05, w * 0.84, h * 0.9);
  c.fillStyle = '#5a1f1f';
  c.font = 'italic bold 52px Georgia';
  c.textAlign = 'center';
  c.fillText('Le Petit Jardin', w / 2, h * 0.13);
  c.font = '26px Georgia';
  c.fillText('— Menu du jour —', w / 2, h * 0.18);
  c.textAlign = 'left';
  const items = [
    ['Soupe à l’oignon gratinée', '9 €'],
    ['Salade de chèvre chaud', '12 €'],
    ['Poulet rôti, pommes frites', '18 €'],
    ['Saumon grillé, riz aux herbes', '21 €'],
    ['Plat végétarien du chef', '16 €'],
    ['Crème brûlée', '8 €'],
    ['Tarte aux pommes', '7 €'],
  ];
  c.fillStyle = '#2b2520';
  items.forEach(([name, price], i) => {
    const y = h * 0.28 + i * h * 0.08;
    c.font = '30px Georgia';
    c.fillText(name, w * 0.14, y);
    c.textAlign = 'right';
    c.fillText(price, w * 0.86, y);
    c.textAlign = 'left';
  });
  c.font = 'italic 22px Georgia';
  c.fillText('Contient des noix. Service non compris.', w * 0.14, h * 0.88);
};

export const SAMPLES: { id: string; label: string; mode: Mode; draw: Draw }[] = [
  { id: 'medicine', label: 'Medicine bottle', mode: 'identify', draw: medicine },
  { id: 'letter', label: 'Utility letter', mode: 'read', draw: letter },
  { id: 'menu', label: 'French menu', mode: 'translate', draw: menu },
];

export async function renderSample(draw: Draw): Promise<Part> {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1200;
  draw(canvas.getContext('2d')!, canvas.width, canvas.height);
  return toJpegPart(canvas, canvas.width, canvas.height);
}
