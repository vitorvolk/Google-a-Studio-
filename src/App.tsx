/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  Calculator, 
  History, 
  AlertTriangle, 
  Trash2, 
  Copy, 
  Check, 
  Database, 
  Clock, 
  Cpu, 
  RefreshCw,
  Archive,
  Info
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { 
  TAMPAS, 
  SELOS, 
  VELOCIDADES, 
  Product, 
  Seal, 
  CalculatedResult, 
  CalculationLog 
} from "./types";

import { 
  db, 
  isFirebaseConfigured, 
  handleFirestoreError, 
  OperationType 
} from "./firebase";

import { 
  collection, 
  addDoc, 
  getDocs, 
  writeBatch, 
  doc, 
  serverTimestamp, 
  query, 
  orderBy 
} from "firebase/firestore";

export default function App() {
  // Machine card states (to preserve specific operator inputs per mach)
  const [inputs, setInputs] = useState<Record<number, { productCod: string; horas: string; passoCustomizado: string }>>({
    1001: { productCod: "079010062", horas: "", passoCustomizado: "76.5" },
    1003: { productCod: "079010060", horas: "", passoCustomizado: "52" },
    1004: { productCod: "079270001", horas: "", passoCustomizado: "8" },
  });

  // Calculation results active on screen per machine card
  const [results, setResults] = useState<Record<number, CalculatedResult | null>>({
    1001: null,
    1003: null,
    1004: null,
  });

  // Copy-paste state trackers
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // History state
  const [history, setHistory] = useState<CalculationLog[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [savingMachineId, setSavingMachineId] = useState<number | null>(null);

  // UI Toast helper
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "info" | "error" } | null>(null);

  // Day of the week simulation (Defaults to current day)
  const [simulatedDay, setSimulatedDay] = useState<number>(() => new Date().getDay());
  
  // Modal visibility for instructions
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);

  // Triggering the weekly Monday check
  // Monday in JS is 1
  const isMonday = simulatedDay === 1;

  // Load calculation log history
  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      if (isFirebaseConfigured && db) {
        const q = query(collection(db, "calculations"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        const fetched: CalculationLog[] = snapshot.docs.map(docSnap => {
          const data = docSnap.data();
          // Convert seconds timestamp or parse standard string
          let createdAtStr = new Date().toISOString();
          if (data.createdAt?.seconds) {
            createdAtStr = new Date(data.createdAt.seconds * 1000).toISOString();
          } else if (typeof data.createdAt === 'string') {
            createdAtStr = data.createdAt;
          }
          
          return {
            id: docSnap.id,
            maquina: data.maquina,
            horasLiquidas: data.horasLiquidas,
            produtoCod: data.produtoCod,
            produtoNome: data.produtoNome,
            totalPecas: data.totalPecas,
            paletesTampas: data.paletesTampas,
            metrosNecessarios: data.metrosNecessarios,
            paletesSelo: data.paletesSelo,
            seloCod: data.seloCod,
            seloNome: data.seloNome,
            hasWarning: !!data.hasWarning,
            createdAt: createdAtStr
          };
        });
        setHistory(fetched);
      } else {
        const local = localStorage.getItem("pcp_calculations_history");
        setHistory(local ? JSON.parse(local) : []);
      }
    } catch (err) {
      console.error("Failed to load history from db:", err);
      // Fallback silently to localStorage on error to guarantee service integrity
      const local = localStorage.getItem("pcp_calculations_history");
      setHistory(local ? JSON.parse(local) : []);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const triggerToast = (text: string, type: "success" | "info" | "error" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Handles input and selection changes per machine
  const handleInputChange = (machineId: number, field: "productCod" | "horas" | "passoCustomizado", value: string) => {
    setInputs(prev => {
      const nextInputs = { ...prev };
      if (field === "productCod") {
        const prod = TAMPAS[value];
        const defaultPasso = prod ? SELOS[prod.seloRef]?.passoMm.toString() : "";
        nextInputs[machineId] = {
          ...nextInputs[machineId],
          productCod: value,
          passoCustomizado: defaultPasso
        };
      } else {
        nextInputs[machineId] = {
          ...nextInputs[machineId],
          [field]: value
        };
      }
      return nextInputs;
    });
  };

  // Business Formulas Engine
  const executeCalculation = (machineId: number) => {
    const config = inputs[machineId];
    const horasLiq = parseFloat(config.horas);

    if (isNaN(horasLiq) || horasLiq <= 0) {
      triggerToast("Digite uma quantidade de horas líquidas válida (maior que zero).", "error");
      return;
    }

    const vel = VELOCIDADES[machineId];
    const prodCod = config.productCod;
    const prod: Product = TAMPAS[prodCod];
    
    if (!prod) {
      triggerToast("Produto selecionado inválido.", "error");
      return;
    }

    const selo: Seal = SELOS[prod.seloRef];

    // Read the user-customized step if valid and > 0, otherwise use selected product's default step
    const passoCustom = parseFloat(config.passoCustomizado);
    const finalPassoMm = !isNaN(passoCustom) && passoCustom > 0 ? passoCustom : selo.passoMm;

    // formulas
    // 1. Total Peças: (Horas Líquidas * Velocidade da Máquina)
    const totalPecas = Math.round(horasLiq * vel);

    // 2. Paletes de Tampas: (Total de Peças / Quantidade de Tampas por Palete)
    const paletesTampas = totalPecas / prod.palete;

    // 3. Metros Necessários: (Total de Peças * Passo do Selo em metros)
    // passoMm is in millimeters, convert to meters
    const passoM = finalPassoMm / 1000;
    const metrosNecessarios = totalPecas * passoM;

    // 4. Paletes de Bobina: (Metros Necessários / Metros por Palete de Bobina)
    const hasWarning = selo.metrosPalete === 1;
    const paletesSelo = hasWarning ? 0 : metrosNecessarios / selo.metrosPalete;

    const result: CalculatedResult = {
      maquina: machineId,
      horasLiquidas: horasLiq,
      totalPecas,
      paletesTampas,
      metrosNecessarios,
      paletesSelo,
      hasWarning,
      seloNome: selo.nome,
      seloCod: selo.cod,
      produtoCod: prodCod,
      produtoNome: prod.nome
    };

    setResults(prev => ({
      ...prev,
      [machineId]: result
    }));

    triggerToast(`Cálculo finalizado para máquina ${machineId}!`, "success");
  };

  // Save specific result to Firebase logs repository
  const handleSaveToHistory = async (machineId: number) => {
    const result = results[machineId];
    if (!result) return;

    setSavingMachineId(machineId);

    try {
      if (isFirebaseConfigured && db) {
        // Create full payload conforming to rules
        const cleanPayload = {
          maquina: result.maquina,
          horasLiquidas: result.horasLiquidas,
          produtoCod: result.produtoCod,
          produtoNome: result.produtoNome,
          totalPecas: result.totalPecas,
          paletesTampas: Number(result.paletesTampas.toFixed(4)),
          metrosNecessarios: Number(result.metrosNecessarios.toFixed(2)),
          paletesSelo: Number(result.paletesSelo.toFixed(4)),
          seloCod: result.seloCod,
          seloNome: result.seloNome,
          hasWarning: result.hasWarning,
          createdAt: serverTimestamp()
        };

        const docRef = await addDoc(collection(db, "calculations"), cleanPayload);
        
        // Optimistic UI updates
        const addedLog: CalculationLog = {
          ...result,
          id: docRef.id,
          createdAt: new Date().toISOString()
        };
        setHistory(prev => [addedLog, ...prev]);
      } else {
        // Fallback local storage
        const addedLog: CalculationLog = {
          ...result,
          id: `local_${Date.now()}`,
          createdAt: new Date().toISOString()
        };
        const currentLocal = localStorage.getItem("pcp_calculations_history");
        const list: CalculationLog[] = currentLocal ? JSON.parse(currentLocal) : [];
        list.unshift(addedLog);
        localStorage.setItem("pcp_calculations_history", JSON.stringify(list));
        setHistory(list);
      }
      triggerToast("Cálculo salvo no histórico com sucesso!", "success");
    } catch (err: any) {
      console.error("Firestore persistence error:", err);
      // Detailed error log compliance
      if (isFirebaseConfigured && db) {
        try {
          handleFirestoreError(err, OperationType.CREATE, "calculations");
        } catch (wrappedErr) {
          console.error("Critical Rules Violation intercepted:", wrappedErr);
        }
      }
      triggerToast("Erro ao salvar no banco. Verifique as regras de segurança.", "error");
    } finally {
      setSavingMachineId(null);
    }
  };

  // Clear log logs
  const handleClearHistory = async () => {
    if (!window.confirm("Deseja realmente apagar todo o histórico de cálculos?")) {
      return;
    }

    setIsLoadingHistory(true);
    try {
      if (isFirebaseConfigured && db && history.length > 0) {
        const batch = writeBatch(db);
        for (const log of history) {
          // Verify it's a real firestore doc
          if (!log.id.startsWith("local_")) {
            const docRef = doc(db, "calculations", log.id);
            batch.delete(docRef);
          }
        }
        await batch.commit();
      }
      // Wipe locals
      localStorage.removeItem("pcp_calculations_history");
      setHistory([]);
      triggerToast("Histórico limpo com sucesso!", "success");
    } catch (err: any) {
      console.error("Failed to batch clear records:", err);
      if (isFirebaseConfigured && db) {
        try {
          handleFirestoreError(err, OperationType.DELETE, "calculations/*");
        } catch (wErr) {
          console.error("Wipe history error captured:", wErr);
        }
      }
      // Clean locals anyway
      localStorage.removeItem("pcp_calculations_history");
      setHistory([]);
      triggerToast("Histórico local resetado.", "info");
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Copy text formatting template for Proteus Order Inputs
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    triggerToast("Copiado com sucesso!", "success");
    setTimeout(() => {
      setCopiedKey(null);
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-ink font-sans selection:bg-brand-accent/20 selection:text-brand-ink py-0">
      
      {/* Toast Warning Popup overlay */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 border border-brand-ink font-mono text-xs max-w-sm font-bold bg-brand-paper shadow-none rounded-none`}
          >
            <div className={`w-2.5 h-2.5 ${
              toastMessage.type === "success" ? "bg-brand-ink" : toastMessage.type === "error" ? "bg-brand-accent" : "bg-neutral-500"
            }`} />
            <span>{toastMessage.text.toUpperCase()}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Monday Alert Banner */}
      <AnimatePresence>
        {isMonday && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-brand-alert text-brand-ink px-4 sm:px-8 py-3.5 border-b border-brand-ink flex items-center justify-between"
          >
            <div className="max-w-7xl mx-auto w-full flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg select-none">⚠️</span>
                <p className="text-xs font-bold uppercase tracking-wider leading-tight">
                  Lembrete de Segunda: Verificar estoque de Fita Adesiva (cx 48), Etiquetas e Ribbon (2 rolos).
                </p>
              </div>
              <div className="flex items-center gap-2 text-[9px] font-mono">
                <span className="bg-brand-ink text-brand-bg font-bold uppercase px-2 py-0.5 select-none font-mono">PCP RIGOR</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main App Bar Container Header */}
      <header className="bg-brand-paper border-b border-brand-ink sticky top-0 z-40 select-none">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          
          {/* Logo Brand Frame */}
          <div className="flex items-center gap-3.5">
            <div className="h-12 w-12 bg-brand-ink flex items-center justify-center text-brand-bg border border-brand-ink">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <h1 className="text-2xl font-serif italic font-bold tracking-tight text-brand-ink">PCP Micro-App</h1>
                <span className="text-[9px] bg-brand-ink text-brand-bg font-mono px-1.5 py-0.5 font-bold tracking-widest">V1.2</span>
              </div>
              <p className="text-[10px] uppercase tracking-wider font-extrabold text-brand-ink/65 font-mono">Controle de Produção & Materiais</p>
            </div>
          </div>

          {/* Action Tools controls and badges */}
          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto text-xs">
            
            {/* Monday Simulation Toggle dropdown */}
            <div className="flex items-center gap-1.5 bg-brand-paper px-2.5 py-1.5 border border-brand-ink rounded-none text-[11px]">
              <span className="text-[9px] font-bold text-brand-ink opacity-60 font-mono">DIA:</span>
              <select
                value={simulatedDay}
                onChange={(e) => setSimulatedDay(Number(e.target.value))}
                className="bg-transparent border-none text-[11px] font-mono font-bold text-brand-ink py-0 pl-1 pr-6 focus:ring-0 focus:outline-none cursor-pointer rounded-none"
              >
                <option value={1}>Segunda (Alerta Ativo)</option>
                <option value={2}>Terça-feira</option>
                <option value={3}>Quarta-feira</option>
                <option value={4}>Quinta-feira</option>
                <option value={5}>Sexta-feira</option>
                <option value={6}>Sábado</option>
                <option value={0}>Domingo</option>
              </select>
            </div>

            {/* FireStore Cloud Sync Status Tag */}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 border font-mono font-bold text-[10px] rounded-none ${
              isFirebaseConfigured 
                ? "bg-brand-ink text-brand-bg border-brand-ink" 
                : "bg-brand-paper text-brand-ink/60 border-brand-ink/30"
            }`}>
              <Database className="w-3.5 h-3.5" />
              <span>{isFirebaseConfigured ? "NUVEM LIVE" : "LOCAL CACHE"}</span>
            </div>

            {/* Instructions button */}
            <button 
              onClick={() => setIsInfoModalOpen(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-brand-bg hover:bg-brand-paper text-brand-ink font-mono font-bold text-[10px] border border-brand-ink rounded-none transition-colors cursor-pointer"
            >
              <Info className="w-3.5 h-3.5" />
              <span>INFO LOG</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Core Layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        
        {/* Step instruction banner */}
        <section className="bg-brand-paper border border-brand-ink rounded-none p-6 sm:p-8 text-brand-ink relative overflow-hidden select-none">
          <div className="absolute -right-16 -bottom-16 opacity-5">
            <Calculator className="w-64 h-64 animate-spin-slow" />
          </div>
          <div className="relative z-10 max-w-2xl space-y-3">
            <span className="text-brand-accent font-mono font-bold uppercase tracking-widest text-[10px]">PCP ASSISTENTE DIGITAL</span>
            <h2 className="text-2xl sm:text-3xl font-serif italic text-brand-ink font-bold tracking-tight">Cálculo Planejado de Bobinas & Tampas</h2>
            <p className="text-brand-ink/80 text-xs sm:text-sm leading-relaxed">
              Calculadora regulada de suporte PCP Nestle para determinação rápida de insumos. Insira as Horas Líquidas operadas para sugerir as quantidades de paletes de bobinas e tampas, evitando excessos de almoxarifado.
            </p>
          </div>
        </section>

        {/* SECTION: Cards list por Máquina (Three main departments) */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5 border-b border-brand-ink pb-2">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-brand-accent" />
              <h3 className="text-xs font-bold text-brand-ink uppercase tracking-wider font-mono">POSTOS DE OPERAÇÃO ATIVOS</h3>
            </div>
            <span className="text-[10px] text-brand-ink/65 font-mono font-bold uppercase">SELECIONE O PRODUTO PROGRAMADO</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {[1001, 1003, 1004].map((machineId) => {
              const currentInput = inputs[machineId];
              const vel = VELOCIDADES[machineId];
              const resultForMachine = results[machineId];

              // Filter products belonging strictly to this machine
              const productsForMachine = Object.entries(TAMPAS).filter(
                ([_, item]) => item.maquina === machineId
              );

              return (
                <div 
                  key={machineId}
                  className="bg-brand-paper rounded-none border border-brand-ink overflow-hidden flex flex-col transition-all hover:shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]"
                >
                  {/* Card Section Header */}
                  <div className="p-4 bg-brand-paper border-b border-brand-ink flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-mono uppercase opacity-75 font-bold tracking-wider">MÁQUINA REGISTRO</span>
                      <h4 className="text-4xl font-extrabold text-brand-ink tracking-tighter leading-none my-1">
                        {machineId}
                      </h4>
                      <p className="text-brand-ink/65 text-[10px] font-serif italic">Linha Coffee & Nutella Cream</p>
                    </div>
                    
                    <div className="text-right">
                      <span className="text-[9px] text-brand-ink/60 block font-mono font-bold">VELOCIDADE NOMINAL</span>
                      <span className="font-mono text-xs font-bold text-brand-ink text-right">{vel.toLocaleString("pt-BR")} PÇS/H</span>
                    </div>
                  </div>

                  {/* Calculations Entry Panel */}
                  <div className="p-5 space-y-4 flex-1">
                    
                    {/* Select Produto */}
                    <div className="space-y-1.5">
                      <label htmlFor={`product-${machineId}`} className="text-[10px] uppercase font-bold tracking-wider text-brand-ink opacity-80 block">
                        Produto Programado
                      </label>
                      <select
                        id={`product-${machineId}`}
                        value={currentInput.productCod}
                        onChange={(e) => handleInputChange(machineId, "productCod", e.target.value)}
                        className="w-full rounded-none border border-brand-ink bg-brand-bg text-brand-ink text-xs focus:ring-0 focus:border-brand-accent p-2.5 font-sans"
                      >
                        {productsForMachine.map(([cod, item]) => (
                          <option key={cod} value={cod}>
                            {cod} - {item.nome} (Palete: {item.palete.toLocaleString("pt-BR")})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {/* Hours Input */}
                      <div className="space-y-1.5">
                        <label htmlFor={`hours-${machineId}`} className="text-[10px] uppercase font-bold tracking-wider text-brand-ink opacity-80 block truncate">
                          Horas Líquidas (H)
                        </label>
                        <div className="relative rounded-none">
                          <input
                            id={`hours-${machineId}`}
                            type="number"
                            step="0.01"
                            min="0"
                            value={currentInput.horas}
                            onChange={(e) => handleInputChange(machineId, "horas", e.target.value)}
                            placeholder="Ex: 8.5"
                            className="w-full rounded-none border border-brand-ink bg-brand-bg text-brand-ink text-xs focus:ring-0 focus:border-brand-accent pr-8 p-2.5 font-sans"
                          />
                          <div className="absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none">
                            <span className="text-brand-ink opacity-60 font-mono text-[9px] font-bold">H</span>
                          </div>
                        </div>
                      </div>

                      {/* Passo do Selo Input */}
                      <div className="space-y-1.5">
                        <label htmlFor={`passo-${machineId}`} className="text-[10px] uppercase font-bold tracking-wider text-brand-ink opacity-80 block truncate">
                          Passo do Selo (mm)
                        </label>
                        <div className="relative rounded-none">
                          <input
                            id={`passo-${machineId}`}
                            type="number"
                            step="0.1"
                            min="0.1"
                            value={currentInput.passoCustomizado ?? ""}
                            onChange={(e) => handleInputChange(machineId, "passoCustomizado", e.target.value)}
                            placeholder="Ex: 52"
                            className="w-full rounded-none border border-brand-ink bg-brand-bg text-brand-ink text-xs focus:ring-0 focus:border-brand-accent pr-9 p-2.5 font-sans font-mono"
                          />
                          <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none">
                            <span className="text-brand-ink opacity-60 font-mono text-[9px] font-bold">MM</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Trigger calculate action */}
                    <button
                      onClick={() => executeCalculation(machineId)}
                      className="w-full bg-brand-ink hover:opacity-90 active:bg-neutral-850 text-brand-bg rounded-none border-none py-2.5 px-4 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 mt-2 cursor-pointer font-serif italic"
                    >
                      <Calculator className="w-4 h-4" />
                      Calcular Demandas
                    </button>
                  </div>

                  {/* RESULTS AND SYSTEM SUGGESTIONS COMPONENT */}
                  <AnimatePresence>
                    {resultForMachine && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="border-t border-brand-ink bg-brand-bg/60 overflow-hidden"
                      >
                        <div className="p-5 space-y-4">
                          <div className="flex items-center justify-between border-b border-brand-ink pb-1.5">
                            <span className="text-[10px] font-bold text-brand-ink uppercase tracking-wider font-mono">DEMANDA COMPUTADA</span>
                            <span className="text-[9px] text-brand-ink/60 font-mono font-bold">MÁQ. {resultForMachine.maquina}</span>
                          </div>

                          {/* Quick numbers badges */}
                          <div className="grid grid-cols-2 gap-2">
                            
                            {/* Total Peças computed */}
                            <div className="p-2.5 bg-brand-paper border border-brand-ink rounded-none select-all relative">
                              <span className="text-[8px] text-brand-ink/60 font-mono font-extrabold block leading-none">TOTAL PEÇAS</span>
                              <span className="font-mono text-base font-extrabold text-brand-ink block mt-1 leading-none">
                                {resultForMachine.totalPecas.toLocaleString("pt-BR")}
                              </span>
                              <span className="text-[8px] text-brand-ink/50 font-mono mt-1.5 block">unidades</span>
                            </div>

                            {/* Paletes de Tampas */}
                            <div className="p-2.5 bg-brand-paper border border-brand-ink rounded-none relative">
                              <span className="text-[8px] text-brand-ink/60 font-mono font-extrabold block leading-none">PALETES TAMPAS</span>
                              <span className="font-mono text-base font-extrabold text-brand-accent block mt-1 leading-none">
                                {resultForMachine.paletesTampas.toFixed(2)}
                              </span>
                              <span className="text-[8px] text-brand-ink/50 font-mono mt-1.5 block">paletes ({TAMPAS[resultForMachine.produtoCod]?.palete.toLocaleString("pt-BR")} un/pal)</span>
                            </div>

                            {/* Metros Necessarios */}
                            <div className="p-2.5 bg-brand-paper border border-brand-ink rounded-none col-span-2">
                              <span className="text-[8px] text-brand-ink/60 font-mono font-extrabold block leading-none">METRAGEM SELO NECESSÁRIA</span>
                              <div className="flex items-baseline justify-between mt-1">
                                <span className="font-mono text-base font-extrabold text-brand-ink">
                                  {resultForMachine.metrosNecessarios.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m
                                </span>
                                <span className="text-[9px] text-brand-ink/50 font-mono">Passo: {SELOS[TAMPAS[resultForMachine.produtoCod]?.seloRef]?.passoMm} mm</span>
                              </div>
                            </div>

                            {/* Paletes de bobina */}
                            <div className="p-2.5 bg-brand-paper border border-brand-ink rounded-none col-span-2">
                              <span className="text-[8px] text-brand-ink/60 font-mono font-extrabold block leading-none font-mono">ESTIMATIVA PALETES SELO</span>
                              {resultForMachine.hasWarning ? (
                                <div className="mt-1.5 p-2 bg-brand-accent/10 border border-brand-accent rounded-none text-brand-accent text-[9px] flex items-center gap-1.5 font-bold uppercase tracking-wider">
                                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span>Falta metragem do palete para calcular</span>
                                </div>
                              ) : (
                                <div className="mt">
                                  <span className="font-mono text-base font-extrabold text-brand-accent">
                                    {resultForMachine.paletesSelo.toFixed(2)}
                                  </span>
                                  <span className="text-[8px] text-brand-ink/50 font-mono block mt-0.5">
                                    paletes ({SELOS[TAMPAS[resultForMachine.produtoCod]?.seloRef]?.metrosPalete.toLocaleString("pt-BR")} m p/ palete)
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* SAP / Proteus Order suggestions snippet */}
                          <div className="p-3 bg-brand-ink text-brand-bg rounded-none border border-brand-ink space-y-2 select-text">
                            <div className="flex items-center justify-between border-b border-brand-bg/20 pb-1.5">
                              <span className="text-[9px] font-mono font-bold text-brand-alert uppercase tracking-wider">Mapeamento ERP Proteus</span>
                              <span className="text-[8px] text-brand-bg opacity-60 font-mono">CLIQUE NO ÍCONE PARA COPIAR</span>
                            </div>
                            
                            <div className="space-y-2 font-mono text-[10px] leading-tight text-brand-bg">
                              {/* Option 1: Tampas Order format */}
                              <div className="pb-1.5 border-b border-brand-bg/10">
                                <div className="flex justify-between items-center text-brand-alert mb-1 font-extrabold uppercase">
                                  <span>Pedido Tampas:</span>
                                  <button
                                    onClick={() => copyToClipboard(`SOLICITACAO ERP PROTEUS: COD TAMPAS: ${resultForMachine.produtoCod} | QTD: ${resultForMachine.paletesTampas.toFixed(2)} PALETES (${resultForMachine.totalPecas.toLocaleString("pt-BR")} UN)`, `${machineId}-tampas`)}
                                    className="p-1 hover:bg-white/10 text-brand-bg/70 hover:text-white transition-colors cursor-pointer"
                                    title="Copiar linha"
                                  >
                                    {copiedKey === `${machineId}-tampas` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                                <div className="text-brand-bg/80 leading-relaxed">
                                  Cod: {resultForMachine.produtoCod} | {resultForMachine.produtoNome}
                                  <br />
                                  Paletes: <span className="text-white font-bold">{resultForMachine.paletesTampas.toFixed(2)}</span> ({resultForMachine.totalPecas.toLocaleString("pt-BR")} un)
                                </div>
                              </div>

                              {/* Option 2: Selos Order format */}
                              <div>
                                <div className="flex justify-between items-center text-brand-alert mb-1 font-extrabold uppercase">
                                  <span>Pedido Selo Bobina:</span>
                                  <button
                                    onClick={() => copyToClipboard(`SOLICITACAO ERP PROTEUS: COD SELOS: ${resultForMachine.seloCod} | QTD: ${resultForMachine.metrosNecessarios.toFixed(1)} METROS ${resultForMachine.hasWarning ? "(Falta metragem palete)" : `(${resultForMachine.paletesSelo.toFixed(2)} PALETES)`}`, `${machineId}-selo`)}
                                    className="p-1 hover:bg-white/10 text-brand-bg/70 hover:text-white transition-colors cursor-pointer"
                                    title="Copiar linha"
                                  >
                                    {copiedKey === `${machineId}-selo` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                                <div className="text-brand-bg/80 leading-relaxed">
                                  Cod: {resultForMachine.seloCod} | {resultForMachine.seloNome}
                                  <br />
                                  Metragem: <span className="text-white font-bold">{resultForMachine.metrosNecessarios.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} m</span>
                                  {!resultForMachine.hasWarning && (
                                    <span> ({resultForMachine.paletesSelo.toFixed(2)} Paletes)</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Trigger saving calculation log in Firebase repository */}
                          <div className="flex gap-2">
                            <button
                              disabled={savingMachineId === machineId}
                              onClick={() => handleSaveToHistory(machineId)}
                              className="flex-1 bg-transparent hover:bg-brand-ink hover:text-brand-bg text-brand-ink font-mono font-bold py-2 px-3 rounded-none text-[11px] transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-brand-ink disabled:opacity-40"
                            >
                              {savingMachineId === machineId ? (
                                <span className="flex items-center gap-1.5">
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  PERSISTINDO...
                                </span>
                              ) : (
                                <>
                                  <Archive className="w-3.5 h-3.5" />
                                  Salvar Histórico
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>

        {/* SECTION: Calculations History log logs saved in Cloud database or storage */}
        <section className="bg-brand-paper rounded-none border border-brand-ink overflow-hidden shadow-none">
          
          {/* Header section with wipe action and listings count */}
          <div className="p-4 border-b border-brand-ink flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-brand-paper select-none">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-brand-ink text-brand-bg flex items-center justify-center">
                <History className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-serif italic font-bold text-slate-900 text-base leading-tight">Histórico de Cálculos Recentes</h3>
                <p className="text-[10px] text-brand-ink/65 uppercase tracking-wider font-semibold font-mono">
                  {isFirebaseConfigured 
                    ? "Armazenamento em Nuvem (Nestlé Cloud Firestore)" 
                    : "Armazenamento Local (Navegador Autônomo)"
                  }
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={isLoadingHistory}
                onClick={loadHistory}
                className="px-3 py-1 bg-transparent hover:bg-brand-ink hover:text-brand-bg text-brand-ink border border-brand-ink font-mono font-bold text-[10px] uppercase rounded-none transition-colors h-8 flex items-center justify-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingHistory ? "animate-spin" : ""}`} />
                Atualizar
              </button>

              <button
                disabled={history.length === 0}
                onClick={handleClearHistory}
                className="px-3 py-1 bg-brand-accent hover:bg-brand-accent/95 text-brand-bg font-mono font-bold text-[10px] uppercase rounded-none transition-colors h-8 flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 border-none"
              >
                <Trash2 className="w-3 h-3" />
                Limpar Banco
              </button>
            </div>
          </div>

          {/* Core Table View for calculation data logs */}
          <div className="overflow-x-auto">
            {history.length === 0 ? (
              <div className="p-12 text-center space-y-3 bg-brand-paper">
                <p className="text-brand-ink/60 text-sm font-serif italic">Nenhum cálculo registrado no banco de dados.</p>
                <p className="text-[10px] text-brand-ink/50 uppercase tracking-widest font-mono">Insira as horas líquidas acima e clique em "Salvar Histórico".</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse min-w-[750px]">
                <thead>
                  <tr className="bg-brand-paper text-[10px] font-bold text-brand-ink uppercase tracking-wider border-b border-brand-ink select-none">
                    <th className="py-3 px-4 font-serif italic text-left">Data / Hora</th>
                    <th className="py-3 px-4 text-left font-mono">MÁQ</th>
                    <th className="py-3 px-4 text-left">Produto Programado</th>
                    <th className="py-3 px-4 text-left">Horas Líquidas</th>
                    <th className="py-3 px-4 text-right">Tampas (Pal)</th>
                    <th className="py-3 px-4 text-left font-serif italic">Insumo Selos</th>
                    <th className="py-3 px-4 text-right">Selo (Pal)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-ink/10 text-xs bg-brand-paper font-mono">
                  {history.map((log) => {
                    const parsedDate = new Date(log.createdAt);
                    const formattedDate = !isNaN(parsedDate.getTime()) 
                      ? parsedDate.toLocaleDateString("pt-BR") 
                      : "--/--/--";
                    const formattedTime = !isNaN(parsedDate.getTime()) 
                      ? parsedDate.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' }) 
                      : "--:--";

                    return (
                      <tr key={log.id} className="hover:bg-brand-bg/40 transition-colors">
                        {/* Timestamp columns */}
                        <td className="py-3.5 px-4 text-brand-ink/80 whitespace-nowrap">
                          {formattedDate} {formattedTime}
                        </td>

                        {/* Machine Column */}
                        <td className="py-3.5 px-4 font-bold text-brand-ink">
                          {log.maquina}
                        </td>

                        {/* Product Code Columns */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold font-sans text-brand-ink">{log.produtoNome}</div>
                          <div className="text-[10px] text-brand-ink/65">{log.produtoCod}</div>
                        </td>

                        {/* Production target hours */}
                        <td className="py-3.5 px-4 text-brand-ink/80">
                          {log.horasLiquidas} H
                        </td>

                        {/* Lids calculated pallets */}
                        <td className="py-3.5 px-4 text-right font-bold text-brand-accent">
                          {log.paletesTampas.toFixed(2)}
                        </td>

                        {/* Seal code details */}
                        <td className="py-3.5 px-4 font-sans">
                          <div className="text-brand-ink font-bold font-mono text-xs">{log.seloNome}</div>
                          <div className="text-[10px] text-brand-ink/65 font-mono">
                            {log.metrosNecessarios ? `${Math.round(log.metrosNecessarios).toLocaleString("pt-BR")} m` : "--"} | {log.seloCod}
                          </div>
                        </td>

                        {/* Seal bobbins calculated pallets */}
                        <td className="py-3.5 px-4 text-right font-bold">
                          {log.hasWarning ? (
                            <span className="text-[10px] text-brand-accent font-extrabold uppercase font-mono">
                              Falta metragem
                            </span>
                          ) : (
                            <span className="text-brand-ink text-right block">
                              {log.paletesSelo ? log.paletesSelo.toFixed(2) : "0.00"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

      </main>

      {/* FOOTER segment containing standard info credits and technical instructions drawer */}
      <footer className="bg-brand-paper border-t border-brand-ink mt-20 py-8 select-none">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-brand-ink/75">
          <div className="flex items-center gap-2 font-mono">
            <span className="font-bold uppercase tracking-wider">SISTEMA PCP METROLOGIA</span>
            <span>•</span>
            <span className="font-serif italic font-bold">Insumo Planejado S/A</span>
          </div>
          <div className="font-mono text-[10px] uppercase opacity-65">
            React • Tailwind CSS • Google Cloud Firestore Realtime
          </div>
        </div>
      </footer>

      {/* INSTRUCTION DRAWER MODAL OVERLAY */}
      <AnimatePresence>
        {isInfoModalOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              
              {/* Back background blur */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsInfoModalOpen(false)}
                className="fixed inset-0 bg-brand-ink/50 backdrop-blur-xs transition-opacity" 
              />

              <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

              {/* Modal Box */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="inline-block align-bottom bg-brand-paper rounded-none text-left overflow-hidden border border-brand-ink transform transition-all sm:my-8 sm:align-middle sm:max-w-xl sm:w-full"
              >
                <div className="bg-brand-paper p-5 border-b border-brand-ink flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-brand-accent" />
                    <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-brand-ink" id="modal-title">
                      Informações de Sincronização
                    </h3>
                  </div>
                  <button 
                    onClick={() => setIsInfoModalOpen(false)}
                    className="text-brand-ink hover:bg-brand-bg p-1 font-bold text-sm rounded-none border border-transparent hover:border-brand-ink cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-6 space-y-4 text-xs text-brand-ink leading-relaxed">
                  <p>
                    Este terminal de PCP está integrado com segurança às APIs da nuvem Google Firebase.
                  </p>
                  
                  <div className="bg-brand-paper border border-brand-ink p-4 rounded-none text-brand-ink space-y-2">
                    <h4 className="font-bold flex items-center gap-1.5 text-brand-accent uppercase tracking-wider font-mono">
                      Status da conexão:
                    </h4>
                    <p className="font-mono text-[11px]">
                      {isFirebaseConfigured 
                        ? "✅ CONEXÃO ESTABELECIDA. SINCRONIZANDO COM CLOUD FIRESTORE EM TEMPO REAL." 
                        : "💾 MODO LOCAL AUTOMÁTICO. OS DADOS ESTÃO SALVOS APENAS NESTE NAVEGADOR (LOCAL STORAGE)."
                      }
                    </p>
                  </div>

                  <h4 className="font-bold uppercase tracking-wider font-mono text-brand-ink">Especificação Técnica de Segurança</h4>
                  <ul className="list-disc pl-5 space-y-1 text-brand-ink/80">
                    <li>Validadores de integridade bloqueiam quaisquer valores de horas menores ou iguais a zero.</li>
                    <li>IDs das máquinas restritos a rotulação confiável de PCP: <code className="bg-brand-bg px-1 font-mono">1001</code>, <code className="bg-brand-bg px-1 font-mono">1003</code>, e <code className="bg-brand-bg px-1 font-mono">1004</code>.</li>
                    <li>Carimbos de data e hora vinculados à hora oficial dos servidores do Cloud Firestore.</li>
                  </ul>

                  <div className="p-3 bg-brand-alert/10 border border-brand-ink rounded-none text-brand-ink text-[11px] font-mono leading-tight">
                    <b>AVISO DE PCP:</b> Toda operação de gravação e limpeza de logs é catalogada e audita no terminal de suprimentos.
                  </div>
                </div>

                <div className="bg-brand-paper p-4 border-t border-brand-ink flex justify-end">
                  <button
                    onClick={() => setIsInfoModalOpen(false)}
                    className="bg-brand-ink text-brand-bg hover:opacity-90 font-mono font-bold text-xs px-4 py-2 rounded-none cursor-pointer uppercase border-none"
                  >
                    Fechar
                  </button>
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
