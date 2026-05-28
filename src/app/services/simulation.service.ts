import { Injectable, signal, computed } from '@angular/core';

/** Parámetros de entrada de la simulación */
export interface SimulationParams {
  m: number;   // Masa (kg)
  c: number;   // Coeficiente de amortiguamiento (N·s/m)
  k: number;   // Rigidez del resorte (N/m)
  h: number;   // Tamaño de paso (s)
}

/** Resultado de una corrida RK4 individual */
export interface RK4Run {
  h: number;
  t: number[];
  x: number[];
  v: number[];
}

/** Datos para la gráfica de respuesta temporal (Escenario 1) */
export interface TimeResponseData {
  /** Tiempo común (malla más fina = h=0.005) */
  t: number[];
  /** Solución analítica exacta evaluada en cada t */
  xAnalytical: number[];
  /** Solución RK4 para cada paso: { h, x[] } */
  rk4Runs: { h: number; x: number[] }[];
}

/** Datos para la gráfica de error relativo (Escenario 2) */
export interface RelativeErrorData {
  /** Una serie por paso h */
  series: { h: number; t: number[]; error: number[] }[];
}

/** Datos para la gráfica de error acumulativo (Escenario 3) */
export interface CumulativeErrorData {
  /** Una serie por paso h */
  series: { h: number; t: number[]; cumError: number[] }[];
}

/** Datos para la gráfica de sensibilidad a la rigidez (Escenario 4) */
export interface StiffnessSensitivityData {
  t: number[];
  /** Una serie por valor de k */
  series: { k: number; x: number[] }[];
}

/** Estado resultante completo de la simulación */
export interface SimulationResult {
  // Datos heredados para compatibilidad (animación 3D, métricas, diagrama de fase)
  t: number[];
  x: number[];
  v: number[];
  a: number[];
  relativeError: number[];
  cumulativeError: number[];
  // ── Nuevos datasets para las 4 gráficas ──
  timeResponse: TimeResponseData;
  relErrData: RelativeErrorData;
  cumErrData: CumulativeErrorData;
  stiffnessData: StiffnessSensitivityData;
}

@Injectable({ providedIn: 'root' })
export class SimulationService {

  // ── Señales de estado ──────────────────────────────────
  public readonly result = signal<SimulationResult>(this.emptyResult());
  public readonly params = signal<SimulationParams>({ m: 300, c: 1000, k: 16000, h: 0.01 });
  public readonly currentPlaybackTime = signal<number>(-1); // -1 = sin reproducción

  // ── Señales derivadas (métricas) ───────────────────────
  public readonly zeta = computed(() => {
    const p = this.params();
    return p.c / (2 * Math.sqrt(p.k * p.m));
  });

  public readonly dampingLabel = computed(() => {
    const z = this.zeta();
    if (z === 0) return 'No Amortiguado';
    if (z < 1) return 'Subamortiguado';
    if (z === 1) return 'Críticamente Amortiguado';
    return 'Sobreamortiguado';
  });

  public readonly stabilizationTime = computed(() => {
    const r = this.result();
    if (r.t.length === 0) return null;
    // Recorrer desde el final hacia atrás buscando |x| > 1mm
    for (let i = r.t.length - 1; i >= 0; i--) {
      if (Math.abs(r.x[i]) > 0.001) {
        return i < r.t.length - 1 ? r.t[i + 1] : null;
      }
    }
    return 0; // Ya está estabilizado desde el inicio
  });

  // ── Métricas de error derivadas ────────────────────────
  public readonly maxRelativeError = computed(() => {
    const r = this.result();
    if (r.relativeError.length === 0) return 0;
    return Math.max(...r.relativeError);
  });

  public readonly totalCumulativeError = computed(() => {
    const r = this.result();
    if (r.cumulativeError.length === 0) return 0;
    return r.cumulativeError[r.cumulativeError.length - 1];
  });

  // ══════════════════════════════════════════════════════════
  // SOLUCIÓN ANALÍTICA EXACTA
  // mx'' + cx' + kx = 0, x(0)=x0, x'(0)=v0
  // ══════════════════════════════════════════════════════════
  private analyticalSolution(
    m: number, c: number, k: number,
    x0: number, v0: number, tArr: number[]
  ): number[] {
    const omega_n = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(k * m));
    const result: number[] = new Array(tArr.length);

    if (zeta < 1) {
      // ── Subamortiguado ──
      const omega_d = omega_n * Math.sqrt(1 - zeta * zeta);
      const A = x0;
      const B = (v0 + zeta * omega_n * x0) / omega_d;
      for (let i = 0; i < tArr.length; i++) {
        const t = tArr[i];
        const exp = Math.exp(-zeta * omega_n * t);
        result[i] = exp * (A * Math.cos(omega_d * t) + B * Math.sin(omega_d * t));
      }
    } else if (zeta === 1) {
      // ── Críticamente amortiguado ──
      const A = x0;
      const B = v0 + omega_n * x0;
      for (let i = 0; i < tArr.length; i++) {
        const t = tArr[i];
        result[i] = (A + B * t) * Math.exp(-omega_n * t);
      }
    } else {
      // ── Sobreamortiguado ──
      const sqrtTerm = omega_n * Math.sqrt(zeta * zeta - 1);
      const r1 = -zeta * omega_n + sqrtTerm;
      const r2 = -zeta * omega_n - sqrtTerm;
      const C1 = (v0 - r2 * x0) / (r1 - r2);
      const C2 = x0 - C1;
      for (let i = 0; i < tArr.length; i++) {
        const t = tArr[i];
        result[i] = C1 * Math.exp(r1 * t) + C2 * Math.exp(r2 * t);
      }
    }

    return result;
  }

  // ══════════════════════════════════════════════════════════
  // RK4 SOLVER
  // Ecuaciones de estado: dx1/dt = x2, dx2/dt = -(c/m)*x2 - (k/m)*x1
  // ══════════════════════════════════════════════════════════
  private solveRK4(m: number, c: number, k: number, h: number, tMax: number): RK4Run {
    const alpha = c / m;   // coeficiente de amortiguamiento normalizado
    const beta = k / m;    // rigidez normalizada
    const steps = Math.round(tMax / h);
    const t: number[] = new Array(steps + 1);
    const x: number[] = new Array(steps + 1);
    const v: number[] = new Array(steps + 1);

    // Condiciones iniciales
    t[0] = 0;
    x[0] = 0.05;
    v[0] = 0;

    for (let i = 0; i < steps; i++) {
      const xi = x[i];
      const vi = v[i];

      // f1(x1, x2) = x2
      // f2(x1, x2) = -alpha * x2 - beta * x1

      const k1x = vi;
      const k1v = -alpha * vi - beta * xi;

      const k2x = vi + 0.5 * h * k1v;
      const k2v = -alpha * (vi + 0.5 * h * k1v) - beta * (xi + 0.5 * h * k1x);

      const k3x = vi + 0.5 * h * k2v;
      const k3v = -alpha * (vi + 0.5 * h * k2v) - beta * (xi + 0.5 * h * k2x);

      const k4x = vi + h * k3v;
      const k4v = -alpha * (vi + h * k3v) - beta * (xi + h * k3x);

      x[i + 1] = xi + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      v[i + 1] = vi + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
      t[i + 1] = +(t[i] + h).toFixed(10); // evitar acumulación de error flotante
    }

    return { h, t, x, v };
  }

  // ══════════════════════════════════════════════════════════
  // GENERADORES DE DATOS PARA LAS 4 GRÁFICAS
  // ══════════════════════════════════════════════════════════

  /**
   * Escenario 1: Respuesta temporal
   * Compara RK4 (en 4 pasos h) frente a la solución analítica exacta.
   * Los datos de cada corrida RK4 se interpolan sobre la malla temporal más fina
   * para poder superponerlos en la misma gráfica.
   */
  private buildTimeResponseData(m: number, c: number, k: number): TimeResponseData {
    const tMax = 5.0;
    const steps = [0.1, 0.05, 0.01, 0.005];

    // Generar corridas RK4
    const runs: RK4Run[] = steps.map(h => this.solveRK4(m, c, k, h, tMax));

    // Malla de referencia: la más fina (h=0.005)
    const tRef = runs[runs.length - 1].t;

    // Solución analítica sobre la malla fina
    const xAnalytical = this.analyticalSolution(m, c, k, 0.05, 0, tRef);

    // Para cada corrida, interpolar sobre tRef
    const rk4Runs = runs.map(run => ({
      h: run.h,
      x: this.interpolateOnGrid(run.t, run.x, tRef)
    }));

    return { t: tRef, xAnalytical, rk4Runs };
  }

  /**
   * Escenario 2: Error relativo
   * |x_RK4(t) - x_analítico(t)| / |x_analítico(t)| × 100
   * Preparado para escala logarítmica en Y: se usa un floor de 1e-16 para evitar log(0).
   */
  private buildRelativeErrorData(m: number, c: number, k: number): RelativeErrorData {
    const tMax = 5.0;
    const steps = [0.1, 0.05, 0.01, 0.005];
    const series: { h: number; t: number[]; error: number[] }[] = [];

    for (const h of steps) {
      const run = this.solveRK4(m, c, k, h, tMax);
      const xAn = this.analyticalSolution(m, c, k, 0.05, 0, run.t);
      const error: number[] = new Array(run.t.length);

      for (let i = 0; i < run.t.length; i++) {
        const absAnalytical = Math.abs(xAn[i]);
        if (absAnalytical > 1e-15) {
          error[i] = Math.max((Math.abs(run.x[i] - xAn[i]) / absAnalytical) * 100, 1e-16);
        } else {
          // Cuando la solución analítica cruza por cero, usar error absoluto escalado
          error[i] = Math.max(Math.abs(run.x[i] - xAn[i]) * 100, 1e-16);
        }
      }

      series.push({ h, t: run.t, error });
    }

    return { series };
  }

  /**
   * Escenario 3: Error acumulativo
   * Σ|x_RK4(t_i) - x_analítico(t_i)| (suma parcial hasta cada instante)
   * Preparado para escala logarítmica en Y.
   */
  private buildCumulativeErrorData(m: number, c: number, k: number): CumulativeErrorData {
    const tMax = 5.0;
    const steps = [0.1, 0.05, 0.01, 0.005];
    const series: { h: number; t: number[]; cumError: number[] }[] = [];

    for (const h of steps) {
      const run = this.solveRK4(m, c, k, h, tMax);
      const xAn = this.analyticalSolution(m, c, k, 0.05, 0, run.t);
      const cumError: number[] = new Array(run.t.length);

      cumError[0] = Math.max(Math.abs(run.x[0] - xAn[0]), 1e-20);
      for (let i = 1; i < run.t.length; i++) {
        cumError[i] = cumError[i - 1] + Math.abs(run.x[i] - xAn[i]);
        cumError[i] = Math.max(cumError[i], 1e-20); // floor para escala log
      }

      series.push({ h, t: run.t, cumError });
    }

    return { series };
  }

  /**
   * Escenario 4: Sensibilidad a la rigidez
   * Desplazamiento RK4 variando k = {12000, 16000, 20000} N/m
   * con el paso h seleccionado por el usuario.
   */
  private buildStiffnessSensitivityData(m: number, c: number, h: number): StiffnessSensitivityData {
    const tMax = 5.0;
    const kValues = [12000, 16000, 20000];
    const runs = kValues.map(kVal => this.solveRK4(m, c, kVal, h, tMax));
    const t = runs[0].t;

    const series = runs.map((run, idx) => ({
      k: kValues[idx],
      x: run.x
    }));

    return { t, series };
  }

  // ══════════════════════════════════════════════════════════
  // INTERPOLACIÓN LINEAL sobre una malla de referencia
  // ══════════════════════════════════════════════════════════
  private interpolateOnGrid(tSrc: number[], xSrc: number[], tDst: number[]): number[] {
    const result: number[] = new Array(tDst.length);
    let j = 0; // índice en tSrc

    for (let i = 0; i < tDst.length; i++) {
      const td = tDst[i];

      // Avanzar j hasta encontrar el intervalo que contiene td
      while (j < tSrc.length - 2 && tSrc[j + 1] < td) {
        j++;
      }

      if (Math.abs(tSrc[j] - td) < 1e-12) {
        result[i] = xSrc[j];
      } else if (j + 1 < tSrc.length && Math.abs(tSrc[j + 1] - td) < 1e-12) {
        result[i] = xSrc[j + 1];
      } else if (j + 1 < tSrc.length) {
        // Interpolación lineal
        const frac = (td - tSrc[j]) / (tSrc[j + 1] - tSrc[j]);
        result[i] = xSrc[j] + frac * (xSrc[j + 1] - xSrc[j]);
      } else {
        result[i] = xSrc[xSrc.length - 1];
      }
    }

    return result;
  }

  // ══════════════════════════════════════════════════════════
  // MÉTODO PRINCIPAL: ejecutar simulación completa
  // ══════════════════════════════════════════════════════════
  public runSimulation(p: SimulationParams): void {
    this.params.set(p);

    const { m, c, k, h } = p;
    const tMax = 5.0;

    // ── Solución principal con el paso h seleccionado ──
    const sol = this.solveRK4(m, c, k, h, tMax);

    // ── Solución analítica para el paso seleccionado (métricas de cabecera) ──
    const xAn = this.analyticalSolution(m, c, k, 0.05, 0, sol.t);

    const steps = sol.t.length;
    const a: number[] = new Array(steps);
    const relativeError: number[] = new Array(steps);
    const cumulativeError: number[] = new Array(steps);

    a[0] = -(c * sol.v[0] + k * sol.x[0]) / m;
    relativeError[0] = 0;
    cumulativeError[0] = 0;

    for (let i = 1; i < steps; i++) {
      a[i] = -(c * sol.v[i] + k * sol.x[i]) / m;

      const absErr = Math.abs(sol.x[i] - xAn[i]);
      relativeError[i] = Math.abs(xAn[i]) > 1e-15
        ? (absErr / Math.abs(xAn[i])) * 100
        : 0;
      cumulativeError[i] = cumulativeError[i - 1] + absErr;
    }

    // ── Construir los 4 datasets ──
    const timeResponse = this.buildTimeResponseData(m, c, k);
    const relErrData = this.buildRelativeErrorData(m, c, k);
    const cumErrData = this.buildCumulativeErrorData(m, c, k);
    const stiffnessData = this.buildStiffnessSensitivityData(m, c, h);

    this.result.set({
      t: sol.t,
      x: sol.x,
      v: sol.v,
      a,
      relativeError,
      cumulativeError,
      timeResponse,
      relErrData,
      cumErrData,
      stiffnessData
    });

    this.currentPlaybackTime.set(-1); // Resetear reproducción
  }

  // ── Helper: resultado vacío ────────────────────────────
  private emptyResult(): SimulationResult {
    return {
      t: [], x: [], v: [], a: [],
      relativeError: [], cumulativeError: [],
      timeResponse: { t: [], xAnalytical: [], rk4Runs: [] },
      relErrData: { series: [] },
      cumErrData: { series: [] },
      stiffnessData: { t: [], series: [] }
    };
  }
}
