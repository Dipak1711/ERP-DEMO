// Demo records for the Die Management module. Every seeded record carries `demo: true`
// and its remarks say so — production counts, costs and makers here are illustrative only.
import type { Die, DieData, DieKind, HistoryEvent, IssueRecord, MaintenanceRecord, MainDie } from './types';

export const emptyDieData = (): DieData => ({
  mainDies: [],
  forgingDies: [],
  trimmingDies: [],
  history: [],
  maintenance: [],
  issues: [],
  images: {},
});

/** Schematic placeholder picture (SVG) so the demo shows image previews without shipping files. */
function sketch(label: string, side: 'TOP' | 'BOTTOM', hue: number) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 22% 46%)"/><stop offset="1" stop-color="hsl(${hue} 18% 20%)"/></linearGradient></defs>` +
    `<rect width="240" height="160" rx="10" fill="url(#g)"/>` +
    `<rect x="38" y="44" width="164" height="72" rx="10" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3"/>` +
    `<ellipse cx="120" cy="80" rx="46" ry="20" fill="#000" fill-opacity=".35" stroke="#fff" stroke-opacity=".7" stroke-width="2"/>` +
    `<text x="120" y="30" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="700" fill="#fff">${label}</text>` +
    `<text x="120" y="142" text-anchor="middle" font-family="sans-serif" font-size="11" letter-spacing="2" fill="#fff" fill-opacity=".85">${side} DIE · DEMO IMAGE</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

type DieSeed = Partial<Die> & Pick<Die, 'code' | 'kind' | 'mainCode' | 'material' | 'makingDate' | 'maker' | 'drawingNo' | 'status'>;

export function buildDieSeed(): DieData {
  const d = emptyDieData();
  const mk = (m: Omit<MainDie, 'demo'>): MainDie => ({ ...m, remarks: `[Demo] ${m.remarks}`, demo: true });

  d.mainDies = [
    mk({ code: 'DIE-0001', name: 'Brass Valve Body', partCode: 'PRT-001', description: 'Forged brass valve body, 1/2" BSP, hot forged and trimmed', customer: 'Apex Fluid Controls', metal: 'Brass', createdOn: '2026-01-05', status: 'Active', remarks: 'Two forging dies — the first was retired and replaced.' }),
    mk({ code: 'DIE-0002', name: 'Aluminium Handle', partCode: 'PRT-002', description: 'Forged aluminium lever handle, anodise finish', customer: 'Nova Hardware', metal: 'Aluminium', createdOn: '2026-02-14', status: 'Active', remarks: 'One forging die and one trimming die.' }),
    mk({ code: 'DIE-0003', name: 'Brass Fitting', partCode: 'PRT-003', description: 'Brass compression fitting body, 15 mm', customer: 'Kaveri Plumbing Co.', metal: 'Brass', createdOn: '2026-03-02', status: 'Active', remarks: 'Two trimming dies — the first was damaged and replaced.' }),
  ];

  const mkDie = (s: DieSeed): Die => ({
    top: {},
    bottom: {},
    revision: 'R0',
    location: '',
    pieces: 0,
    remarks: '',
    createdAt: `${s.makingDate}T09:00:00`,
    updatedAt: `${s.makingDate}T09:00:00`,
    ...s,
    demo: true,
  });

  const dies: DieSeed[] = [
    { code: 'FGD-0001', kind: 'forging', mainCode: 'DIE-0001', material: 'H13', makingDate: '2026-01-10', maker: 'ABC Toolroom', drawingNo: 'DWG-VB-F-01', revision: 'R1', top: { l: 220, w: 180, h: 95 }, bottom: { l: 220, w: 180, h: 110 }, topWeight: 28.5, bottomWeight: 33.2, status: 'Retired', location: 'Rack A-1 (scrap yard)', cost: 185000, pieces: 41500, remarks: '[Demo] Worn out after the demo run count; replaced by FGD-0002.', replacedByCode: 'FGD-0002', lastMaintDate: '2026-04-18', maintRemarks: 'Re-polished impression, welded edge build-up (demo).' },
    { code: 'FGD-0002', kind: 'forging', mainCode: 'DIE-0001', material: 'H13 (ESR)', makingDate: '2026-06-12', maker: 'ABC Toolroom', drawingNo: 'DWG-VB-F-01', revision: 'R2', top: { l: 220, w: 180, h: 95 }, bottom: { l: 220, w: 180, h: 110 }, topWeight: 28.4, bottomWeight: 33.1, status: 'Available', location: 'Rack A-2', cost: 205000, pieces: 12800, remarks: '[Demo] Replacement for FGD-0001 with improved flash gutter.', replacesCode: 'FGD-0001' },
    { code: 'FGD-0003', kind: 'forging', mainCode: 'DIE-0002', material: 'H11', makingDate: '2026-02-28', maker: 'Shree Die Works', drawingNo: 'DWG-AH-F-01', revision: 'R0', top: { l: 260, w: 140, h: 80 }, bottom: { l: 260, w: 140, h: 90 }, topWeight: 22, bottomWeight: 25.6, status: 'In Production', location: 'Press 2 bolster', cost: 142000, pieces: 18200, remarks: '[Demo] Running on the 400 T press.' },
    { code: 'FGD-0004', kind: 'forging', mainCode: 'DIE-0003', material: 'H13', makingDate: '2026-03-20', maker: 'XYZ Dies', drawingNo: 'DWG-BF-F-01', revision: 'R0', top: { l: 180, w: 150, h: 85 }, bottom: { l: 180, w: 150, h: 95 }, topWeight: 18.2, bottomWeight: 20.7, status: 'Available', location: 'Rack B-1', cost: 120000, pieces: 26400, remarks: '[Demo] Single-impression die.' },
    { code: 'TRD-0001', kind: 'trimming', mainCode: 'DIE-0001', material: 'D2', makingDate: '2026-01-20', maker: 'XYZ Dies', drawingNo: 'DWG-VB-T-01', revision: 'R0', top: { l: 200, w: 160, h: 60 }, bottom: { l: 200, w: 160, h: 70 }, topWeight: 14.8, bottomWeight: 17.1, status: 'Available', location: 'Rack A-3', cost: 64000, pieces: 54300, remarks: '[Demo] Trimming die kept in service through the forging die replacement.' },
    { code: 'TRD-0002', kind: 'trimming', mainCode: 'DIE-0002', material: 'D2', makingDate: '2026-03-05', maker: 'XYZ Dies', drawingNo: 'DWG-AH-T-01', revision: 'R1', top: { l: 240, w: 130, h: 55 }, bottom: { l: 240, w: 130, h: 65 }, topWeight: 12.4, bottomWeight: 14.9, status: 'Under Maintenance', location: 'Toolroom bench 3', cost: 58000, pieces: 17900, remarks: '[Demo] Cutting edge being re-ground.', lastMaintDate: '2026-10-06', maintRemarks: 'Punch and cutting edge re-grinding in progress (demo).' },
    { code: 'TRD-0003', kind: 'trimming', mainCode: 'DIE-0003', material: 'D2', makingDate: '2026-03-25', maker: 'ABC Toolroom', drawingNo: 'DWG-BF-T-01', revision: 'R0', top: { l: 170, w: 140, h: 50 }, bottom: { l: 170, w: 140, h: 60 }, topWeight: 10.9, bottomWeight: 12.8, status: 'Damaged', location: 'Toolroom quarantine', cost: 52000, pieces: 22100, remarks: '[Demo] Cracked bolster — beyond repair; replaced by TRD-0004.', replacedByCode: 'TRD-0004' },
    { code: 'TRD-0004', kind: 'trimming', mainCode: 'DIE-0003', material: 'D2 (cryo-treated)', makingDate: '2026-09-02', maker: 'Shree Die Works', drawingNo: 'DWG-BF-T-01', revision: 'R1', top: { l: 170, w: 140, h: 50 }, bottom: { l: 170, w: 140, h: 60 }, topWeight: 10.8, bottomWeight: 12.7, status: 'Available', location: 'Rack B-2', cost: 61000, pieces: 3200, remarks: '[Demo] Replacement for TRD-0003.', replacesCode: 'TRD-0003' },
  ];

  const hue = { forging: 28, trimming: 205 } as const;
  for (const s of dies) {
    const topId = `IMG-${s.code}-T`;
    const botId = `IMG-${s.code}-B`;
    d.images[topId] = sketch(s.code, 'TOP', hue[s.kind]);
    d.images[botId] = sketch(s.code, 'BOTTOM', hue[s.kind]);
    (s.kind === 'forging' ? d.forgingDies : d.trimmingDies).push(mkDie({ ...s, topImg: topId, bottomImg: botId }));
  }

  let n = 0;
  const ev = (kind: DieKind, dieCode: string, mainCode: string, date: string, event: string, remarks: string) => {
    const h: HistoryEvent = { id: `H-${String(++n).padStart(4, '0')}`, at: `${date}T09:00:00`, date, kind, dieCode, mainCode, event, remarks, demo: true };
    d.history.push(h);
  };
  for (const x of [...d.forgingDies, ...d.trimmingDies]) ev(x.kind, x.code, x.mainCode, x.makingDate, 'Die created', `Made by ${x.maker}, material ${x.material}.`);
  ev('forging', 'FGD-0001', 'DIE-0001', '2026-04-18', 'Maintenance recorded', 'Re-polished impression, welded edge build-up.');
  ev('forging', 'FGD-0001', 'DIE-0001', '2026-06-10', 'Status changed', 'Available → Retired. Impression wear beyond tolerance.');
  ev('forging', 'FGD-0001', 'DIE-0001', '2026-06-12', 'Replacement die created', 'Replaced by FGD-0002. Trimming die TRD-0001 not affected.');
  ev('forging', 'FGD-0002', 'DIE-0001', '2026-06-12', 'Replacement die created', 'Replacement for FGD-0001.');
  ev('forging', 'FGD-0003', 'DIE-0002', '2026-03-10', 'Status changed', 'Available → In Production.');
  ev('trimming', 'TRD-0002', 'DIE-0002', '2026-10-06', 'Maintenance recorded', 'Punch and cutting edge re-grinding.');
  ev('trimming', 'TRD-0002', 'DIE-0002', '2026-10-06', 'Status changed', 'Available → Under Maintenance.');
  ev('trimming', 'TRD-0003', 'DIE-0003', '2026-08-28', 'Die marked damaged', 'Cracked bolster found during inspection.');
  ev('trimming', 'TRD-0003', 'DIE-0003', '2026-09-02', 'Replacement die created', 'Replaced by TRD-0004. Forging die FGD-0004 not affected.');
  ev('trimming', 'TRD-0004', 'DIE-0003', '2026-09-02', 'Replacement die created', 'Replacement for TRD-0003.');

  const mt = (id: number, x: Omit<MaintenanceRecord, 'id' | 'demo'>): MaintenanceRecord => ({ id: `M-${String(id).padStart(4, '0')}`, ...x, demo: true });
  d.maintenance = [
    mt(1, { kind: 'forging', dieCode: 'FGD-0001', date: '2026-04-18', remarks: 'Re-polished impression, welded edge build-up.' }),
    mt(2, { kind: 'trimming', dieCode: 'TRD-0002', date: '2026-10-06', remarks: 'Punch and cutting edge re-grinding in progress.' }),
  ];

  const is = (id: number, x: Omit<IssueRecord, 'id' | 'demo'>): IssueRecord => ({ id: `I-${String(id).padStart(4, '0')}`, ...x, demo: true });
  d.issues = [
    is(1, { kind: 'forging', dieCode: 'FGD-0002', issuedOn: '2026-06-15', issuedTo: 'Press 1 — 630 T', remarks: 'Trial run', returnedOn: '2026-06-17', pieces: 2800, returnRemarks: 'Trial approved (demo count).' }),
    is(2, { kind: 'forging', dieCode: 'FGD-0003', issuedOn: '2026-10-01', issuedTo: 'Press 2 — 400 T', remarks: 'Handle batch HND-210' }),
  ];

  return d;
}
