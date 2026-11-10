// Build volumes (width x depth x height, mm) of common printers with a 0.4 mm nozzle.
// Values are public manufacturer specifications.
export const PRINTERS = [
  ['bambu-lab-a1-mini', 'Bambu Lab', 'A1 mini', 180, 180, 180], ['bambu-lab-a1', 'Bambu Lab', 'A1', 256, 256, 256],
  ['bambu-lab-p1s', 'Bambu Lab', 'P1S / P1P', 256, 256, 250], ['bambu-lab-x1-carbon', 'Bambu Lab', 'X1 Carbon / X1E', 256, 256, 250],
  ['bambu-lab-h2d', 'Bambu Lab', 'H2D', 350, 320, 325], ['bambu-lab-h2s', 'Bambu Lab', 'H2S', 340, 320, 340],
  ['prusa-mini', 'Prusa', 'MINI+', 180, 180, 180], ['prusa-mk4s', 'Prusa', 'MK4S / MK4', 250, 210, 220], ['prusa-mk3s', 'Prusa', 'MK3S+', 250, 210, 210],
  ['prusa-core-one', 'Prusa', 'CORE One', 250, 220, 270], ['prusa-xl', 'Prusa', 'XL', 360, 360, 360],
  ['creality-ender-3-v3', 'Creality', 'Ender-3 V3 / V3 SE', 220, 220, 250], ['creality-ender-3-s1', 'Creality', 'Ender-3 S1 / S1 Pro', 220, 220, 270],
  ['creality-ender-3-v3-plus', 'Creality', 'Ender-3 V3 Plus', 300, 300, 330], ['creality-k1', 'Creality', 'K1 / K1C / K1 SE', 220, 220, 250],
  ['creality-k1-max', 'Creality', 'K1 Max', 300, 300, 300], ['creality-k2-plus', 'Creality', 'K2 Plus', 350, 350, 350],
  ['elegoo-neptune-4', 'Elegoo', 'Neptune 4 / 4 Pro', 225, 225, 265], ['elegoo-neptune-4-max', 'Elegoo', 'Neptune 4 Max', 420, 420, 480], ['elegoo-centauri-carbon', 'Elegoo', 'Centauri Carbon', 256, 256, 256],
  ['anycubic-kobra-3', 'Anycubic', 'Kobra 3', 250, 250, 260], ['anycubic-kobra-s1', 'Anycubic', 'Kobra S1', 250, 250, 250],
  ['qidi-q1-pro', 'Qidi', 'Q1 Pro', 245, 245, 240], ['qidi-plus4', 'Qidi', 'Plus4', 305, 305, 280],
  ['voron-2.4-300', 'Voron', '2.4 (300)', 300, 300, 280], ['voron-trident-250', 'Voron', 'Trident (250)', 250, 250, 250],
  ['snapmaker-u1', 'Snapmaker', 'U1', 270, 270, 270], ['flashforge-ad5m', 'Flashforge', 'Adventurer 5M', 220, 220, 220],
  ['custom', 'Custom', 'Custom size', 200, 200, 200],
].map(([id, vendor, model, w, d, h]) => ({ id, vendor, model, w, d, h }));
export const printerById = (id) => PRINTERS.find((p) => p.id === id) || PRINTERS[3];

export const MATERIALS = {
  pla: { label: 'PLA', density: 1.24, price: 20, speed: 1 }, petg: { label: 'PETG', density: 1.27, price: 22, speed: 0.85 },
  abs: { label: 'ABS', density: 1.04, price: 22, speed: 0.9 }, asa: { label: 'ASA', density: 1.07, price: 26, speed: 0.9 },
  tpu: { label: 'TPU', density: 1.21, price: 30, speed: 0.4 }, pa: { label: 'PA / Nylon', density: 1.14, price: 40, speed: 0.7 },
  pc: { label: 'PC', density: 1.2, price: 35, speed: 0.7 },
};
