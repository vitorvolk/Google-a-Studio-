export interface Product {
  nome: string;
  palete: number;
  seloRef: string;
  maquina: number;
}

export interface Seal {
  cod: string;
  nome: string;
  metrosPalete: number;
  passoMm: number;
}

export interface CalculatedResult {
  maquina: number;
  horasLiquidas: number;
  totalPecas: number;
  paletesTampas: number;
  metrosNecessarios: number;
  paletesSelo: number;
  hasWarning: boolean;
  seloNome: string;
  seloCod: string;
  produtoCod: string;
  produtoNome: string;
}

export interface CalculationLog extends CalculatedResult {
  id: string;
  createdAt: string; // ISO String or date label
}

export const VELOCIDADES: Record<number, number> = {
  1001: 6720,
  1003: 10800,
  1004: 12000
};

export const TAMPAS: Record<string, Product> = {
  "079010062": { nome: "Original 200g", palete: 10500, seloRef: "nescafe200g", maquina: 1001 },
  "079010069": { nome: "Tradição 200g", palete: 10500, seloRef: "nescafe200g", maquina: 1001 },
  "079010065": { nome: "Listo 200g", palete: 10500, seloRef: "nescafe200g", maquina: 1001 },
  "079010060": { nome: "Original 50g", palete: 35000, seloRef: "nescafe50g", maquina: 1003 },
  "079010067": { nome: "Tradição 50g", palete: 35000, seloRef: "nescafe50g", maquina: 1003 },
  "079010063": { nome: "Listo 50g", palete: 35000, seloRef: "nescafe50g", maquina: 1003 },
  "079010061": { nome: "Original 100g", palete: 20000, seloRef: "nescafe100g", maquina: 1003 },
  "079010068": { nome: "Tradição 100g", palete: 20000, seloRef: "nescafe100g", maquina: 1003 },
  "079010064": { nome: "Listo 100g", palete: 20000, seloRef: "nescafe100g", maquina: 1003 },
  "079010093": { nome: "Ice 100g", palete: 20000, seloRef: "nescafe100g", maquina: 1003 },
  "079270001": { nome: "Nutella 140g", palete: 27300, seloRef: "nutella140g", maquina: 1004 },
  "079270002": { nome: "Nutella 350g", palete: 14700, seloRef: "nutella350g", maquina: 1004 }
};

export const SELOS: Record<string, Seal> = {
  nescafe50g: { cod: "020050114", nome: "Selo 50g", metrosPalete: 10800, passoMm: 52 },
  nescafe100g: { cod: "020050115", nome: "Selo 100g", metrosPalete: 9000, passoMm: 62 },
  nescafe200g: { cod: "020050116", nome: "Selo 200g", metrosPalete: 7200, passoMm: 76.5 },
  nutella140g: { cod: "020050063", nome: "Selo Nutella 140g", metrosPalete: 3780, passoMm: 8 },
  nutella350g: { cod: "020050064", nome: "Selo Nutella 350g", metrosPalete: 3780, passoMm: 8 }
};
