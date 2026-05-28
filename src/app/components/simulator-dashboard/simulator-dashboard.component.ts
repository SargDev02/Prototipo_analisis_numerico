import {
  Component, OnInit, OnDestroy, ViewChild,
  inject, effect, ChangeDetectionStrategy
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Subscription } from 'rxjs';
import { NgxEchartsModule } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { SimulationService } from '../../services/simulation.service';
import { DigitalTwin3DComponent } from '../digital-twin-3d/digital-twin-3d.component';

@Component({
  selector: 'app-simulator-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, NgxEchartsModule, DigitalTwin3DComponent, DecimalPipe],
  template: `
    <!-- ===== SHELL ===== -->
    <div class="dashboard">

      <!-- HEADER -->
      <header class="glass-card header">
        <div class="header-text">
          <h1 class="header-title">Simulador de Suspensión</h1>
          <p class="header-subtitle">Modelo Runge-Kutta 4to Orden · Cuarto de Vehículo</p>
        </div>
        <button class="btn-simulate" (click)="onSimulate()">
          <span class="btn-icon">▶</span> SIMULAR IMPACTO
        </button>
      </header>

      <!-- MAIN GRID -->
      <div class="main-grid">

        <!-- ─── PANEL IZQUIERDO ─────────────────────── -->
        <aside class="left-panel">

          <!-- Parámetros -->
          <section class="glass-card">
            <h2 class="section-title"><span class="accent-bar"></span>Parámetros Físicos</h2>
            <form [formGroup]="form" class="param-form">

              <div class="param-row">
                <label>Masa (m)<span class="param-val">{{ form.value.m }} kg</span></label>
                <input type="range" formControlName="m" min="100" max="500" step="10">
              </div>

              <div class="param-row">
                <label>Amortiguamiento (c)<span class="param-val">{{ form.value.c }} N·s/m</span></label>
                <input type="range" formControlName="c" min="0" max="3000" step="50">
              </div>

              <div class="param-row">
                <label>Rigidez (k)<span class="param-val">{{ form.value.k }} N/m</span></label>
                <input type="range" formControlName="k" min="5000" max="30000" step="500">
              </div>

              <div class="param-row">
                <label>Paso RK4 (h)</label>
                <select formControlName="h">
                  <option value="0.1">0.1 s</option>
                  <option value="0.05">0.05 s</option>
                  <option value="0.01">0.01 s (Recomendado)</option>
                  <option value="0.005">0.005 s (Alta Precisión)</option>
                </select>
              </div>

            </form>
          </section>

          <!-- Métricas -->
          <div class="metrics-grid">
            <div class="metric-card" [class.metric-sky]="zeta() < 1" [class.metric-green]="zeta() >= 1">
              <span class="metric-label">Razón de Amortiguamiento (ζ)</span>
              <span class="metric-value">{{ zeta() | number:'1.3-3' }}</span>
              <span class="metric-tag">
                <span class="dot" [class.dot-sky]="zeta() < 1" [class.dot-green]="zeta() >= 1"></span>
                {{ dampingLabel() }}
              </span>
            </div>
            <div class="metric-card metric-purple">
              <span class="metric-label">Estabilización (|x| &lt; 1 mm)</span>
              <span class="metric-value">{{ stabTime() !== null ? (stabTime() | number:'1.2-2') + ' s' : '> 5 s' }}</span>
              <span class="metric-tag"><span class="dot dot-purple"></span>Tiempo de reposo</span>
            </div>
          </div>

          <!-- Métricas de Error -->
          <div class="metrics-grid">
            <div class="metric-card metric-amber">
              <span class="metric-label">Error Relativo Máx.</span>
              <span class="metric-value">{{ maxRelErr() | number:'1.4-6' }}%</span>
              <span class="metric-tag"><span class="dot dot-amber"></span>h vs h/2</span>
            </div>
            <div class="metric-card metric-rose">
              <span class="metric-label">Error Acumulativo Total</span>
              <span class="metric-value">{{ totalCumErr() | number:'1.6-8' }}</span>
              <span class="metric-tag"><span class="dot dot-rose"></span>Σ|Δx|</span>
            </div>
          </div>

        </aside>

        <!-- ─── PANEL DERECHO ───────────────────────── -->
        <main class="right-panel">

          <!-- 3D -->
          <section class="glass-card twin-wrapper">
            <div class="twin-badge">
              <span class="pulse-dot"></span>
              <span>GEMELO DIGITAL 3D</span>
            </div>
            <app-digital-twin-3d #twin></app-digital-twin-3d>
          </section>

          <!-- Gráficas -->
          <div class="charts-grid">
            <section class="glass-card chart-box">
              <div echarts [options]="timeOpts" [merge]="timeMerge" class="chart-canvas"></div>
            </section>
            <section class="glass-card chart-box">
              <div echarts [options]="phaseOpts" [merge]="phaseMerge" class="chart-canvas"></div>
            </section>
          </div>

          <!-- Gráficas de Error -->
          <div class="charts-grid">
            <section class="glass-card chart-box">
              <div echarts [options]="relErrOpts" [merge]="relErrMerge" class="chart-canvas"></div>
            </section>
            <section class="glass-card chart-box">
              <div echarts [options]="cumErrOpts" [merge]="cumErrMerge" class="chart-canvas"></div>
            </section>
          </div>

        </main>
      </div>
    </div>
  `,
  styles: [`
    /* ═══ Layout Shell ═══════════════════════════════════ */
    .dashboard {
      min-height: 100vh;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      box-sizing: border-box;
    }

    .glass-card {
      background: rgba(255,255,255,0.75);
      border: 1px solid rgba(148,163,184,0.25);
      border-radius: 16px;
      backdrop-filter: blur(16px);
      box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04);
    }

    /* ═══ Header ═════════════════════════════════════════ */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 28px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .header-title {
      font-size: 26px;
      font-weight: 800;
      background: linear-gradient(135deg, #0284c7, #7c3aed);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin: 0;
    }
    .header-subtitle {
      font-size: 13px;
      color: #64748b;
      margin: 4px 0 0;
    }
    .btn-simulate {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 28px;
      border: 1px solid rgba(2,132,199,0.35);
      border-radius: 12px;
      background: rgba(2,132,199,0.1);
      color: #0284c7;
      font-weight: 700;
      font-size: 14px;
      letter-spacing: 0.5px;
      cursor: pointer;
      transition: all 0.25s ease;
      box-shadow: 0 0 20px rgba(2,132,199,0.1);
    }
    .btn-simulate:hover {
      background: rgba(2,132,199,0.18);
      box-shadow: 0 0 30px rgba(2,132,199,0.2);
      transform: translateY(-1px);
    }
    .btn-icon { font-size: 11px; }

    /* ═══ Main Grid ══════════════════════════════════════ */
    .main-grid {
      display: grid;
      grid-template-columns: 340px 1fr;
      gap: 20px;
      flex: 1;
    }
    @media (max-width: 1024px) {
      .main-grid { grid-template-columns: 1fr; }
    }

    /* ═══ Left Panel ═════════════════════════════════════ */
    .left-panel {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      font-weight: 700;
      color: #1e293b;
      margin: 0 0 20px;
    }
    .accent-bar {
      width: 4px;
      height: 22px;
      border-radius: 4px;
      background: #0284c7;
    }

    .glass-card:has(.param-form) { padding: 24px; }

    .param-form {
      display: flex;
      flex-direction: column;
      gap: 22px;
    }
    .param-row label {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      font-weight: 500;
      color: #475569;
      margin-bottom: 10px;
    }
    .param-val {
      color: #0284c7;
      font-weight: 700;
    }
    .param-row select {
      width: 100%;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      color: #1e293b;
      font-size: 13px;
      outline: none;
      -webkit-appearance: none;
      appearance: none;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .param-row select:focus { border-color: #0284c7; }

    /* ═══ Metrics ════════════════════════════════════════ */
    .metrics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .metric-card {
      position: relative;
      overflow: hidden;
      padding: 18px;
      border-radius: 16px;
      background: rgba(255,255,255,0.85);
      border: 1px solid rgba(148,163,184,0.2);
      display: flex;
      flex-direction: column;
      gap: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .metric-card::before {
      content: '';
      position: absolute;
      top: -10px;
      right: -10px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      filter: blur(25px);
    }
    .metric-sky { box-shadow: inset 0 0 0 1px rgba(2,132,199,0.2); }
    .metric-sky::before { background: rgba(2,132,199,0.15); }
    .metric-green { box-shadow: inset 0 0 0 1px rgba(16,185,129,0.2); }
    .metric-green::before { background: rgba(16,185,129,0.15); }
    .metric-purple { box-shadow: inset 0 0 0 1px rgba(124,58,237,0.2); }
    .metric-purple::before { background: rgba(124,58,237,0.15); }
    .metric-amber { box-shadow: inset 0 0 0 1px rgba(217,119,6,0.2); }
    .metric-amber::before { background: rgba(217,119,6,0.15); }
    .metric-rose { box-shadow: inset 0 0 0 1px rgba(225,29,72,0.2); }
    .metric-rose::before { background: rgba(225,29,72,0.15); }

    .metric-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #64748b;
    }
    .metric-value {
      font-size: 26px;
      font-weight: 800;
      color: #0f172a;
    }
    .metric-tag {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 500;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }
    .dot-sky { background: #0284c7; color: #0284c7; }
    .dot-green { background: #059669; color: #059669; }
    .dot-purple { background: #7c3aed; color: #7c3aed; }
    .dot-amber { background: #d97706; color: #d97706; }
    .dot-rose { background: #e11d48; color: #e11d48; }
    .metric-sky .metric-tag { color: #0284c7; }
    .metric-green .metric-tag { color: #059669; }
    .metric-purple .metric-tag { color: #7c3aed; }
    .metric-amber .metric-tag { color: #d97706; }
    .metric-rose .metric-tag { color: #e11d48; }

    /* ═══ Right Panel ════════════════════════════════════ */
    .right-panel {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* ═══ 3D Twin ════════════════════════════════════════ */
    .twin-wrapper {
      position: relative;
      height: 420px;
      padding: 4px;
    }
    .twin-badge {
      position: absolute;
      top: 16px;
      left: 16px;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 100px;
      background: rgba(255,255,255,0.9);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(148,163,184,0.3);
      font-size: 11px;
      font-weight: 600;
      color: #1e293b;
      letter-spacing: 0.6px;
    }
    .pulse-dot {
      position: relative;
      width: 8px;
      height: 8px;
    }
    .pulse-dot::before, .pulse-dot::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: #0284c7;
    }
    .pulse-dot::before {
      animation: pulse-ring 1.8s infinite;
    }
    @keyframes pulse-ring {
      0%   { transform: scale(1); opacity: 0.8; }
      100% { transform: scale(2.5); opacity: 0; }
    }

    /* ═══ Charts ═════════════════════════════════════════ */
    .charts-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 768px) {
      .charts-grid { grid-template-columns: 1fr; }
    }
    .chart-box { padding: 16px; }
    .chart-canvas {
      width: 100%;
      height: 340px;
    }
  `]
})
export class SimulatorDashboardComponent implements OnInit, OnDestroy {
  @ViewChild('twin') twin!: DigitalTwin3DComponent;

  private fb = inject(FormBuilder);
  private sim = inject(SimulationService);
  private sub!: Subscription;

  // Señales expuestas al template
  protected zeta = this.sim.zeta;
  protected dampingLabel = this.sim.dampingLabel;
  protected stabTime = this.sim.stabilizationTime;
  protected maxRelErr = this.sim.maxRelativeError;
  protected totalCumErr = this.sim.totalCumulativeError;

  // Formulario
  form = this.fb.group({
    m: [300],
    c: [1000],
    k: [16000],
    h: ['0.01']   // select devuelve string
  });

  // ── Colores y paleta ──────────────────────────────────
  private readonly TXT = '#64748b';
  private readonly GRID = '#e2e8f0';
  private readonly STEP_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#0284c7'];
  private readonly STEP_LABELS = ['h = 0.1 s', 'h = 0.05 s', 'h = 0.01 s', 'h = 0.005 s'];
  private readonly K_COLORS = ['#f59e0b', '#0284c7', '#7c3aed'];

  // ── ECharts: Gráfica 1 — Respuesta Temporal ───────────
  timeOpts: EChartsOption = {
    backgroundColor: 'transparent',
    title: { text: 'Respuesta Temporal: RK4 vs Analítica', textStyle: { color: '#1e293b', fontSize: 14, fontWeight: 'bold' } },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#cbd5e1', textStyle: { color: '#1e293b', fontSize: 12 } },
    legend: {
      data: ['Analítica', ...this.STEP_LABELS],
      bottom: 0, textStyle: { color: this.TXT, fontSize: 10 },
      itemWidth: 14, itemHeight: 10
    },
    grid: { left: '12%', right: '4%', top: '18%', bottom: '22%' },
    xAxis: {
      type: 'value', name: 'Tiempo (s)', nameLocation: 'middle', nameGap: 28,
      nameTextStyle: { color: this.TXT }, axisLabel: { color: this.TXT },
      axisLine: { lineStyle: { color: '#cbd5e1' } }, splitLine: { lineStyle: { color: this.GRID, type: 'dashed' } }
    },
    yAxis: {
      type: 'value', name: 'Desplazamiento (m)',
      nameTextStyle: { color: this.TXT }, axisLabel: { color: this.TXT },
      axisLine: { lineStyle: { color: '#cbd5e1' } }, splitLine: { lineStyle: { color: this.GRID } }
    },
    series: [
      {
        name: 'Analítica', type: 'line', showSymbol: false, smooth: true,
        itemStyle: { color: '#1e293b' },
        lineStyle: { width: 3, type: 'solid', shadowColor: 'rgba(0,0,0,0.15)', shadowBlur: 6 },
        z: 10
      },
      ...this.STEP_LABELS.map((label, idx) => ({
        name: label, type: 'line' as const, showSymbol: false, smooth: true,
        itemStyle: { color: this.STEP_COLORS[idx] },
        lineStyle: { width: 1.5, type: (idx < 2 ? 'dashed' : 'solid') as any },
        z: 5 - idx
      }))
    ]
  };

  // ── ECharts: Gráfica 2 — Sensibilidad a la Rigidez ───
  phaseOpts: EChartsOption = {
    backgroundColor: 'transparent',
    title: { text: 'Sensibilidad a la Rigidez (k)', textStyle: { color: '#1e293b', fontSize: 14, fontWeight: 'bold' } },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#cbd5e1', textStyle: { color: '#1e293b', fontSize: 12 } },
    legend: {
      data: ['k = 12000 N/m', 'k = 16000 N/m', 'k = 20000 N/m'],
      bottom: 0, textStyle: { color: this.TXT, fontSize: 10 },
      itemWidth: 14, itemHeight: 10
    },
    grid: { left: '12%', right: '4%', top: '18%', bottom: '22%' },
    xAxis: {
      type: 'value', name: 'Tiempo (s)', nameLocation: 'middle', nameGap: 28,
      nameTextStyle: { color: this.TXT }, axisLabel: { color: this.TXT },
      axisLine: { lineStyle: { color: '#cbd5e1' } }, splitLine: { lineStyle: { color: this.GRID, type: 'dashed' } }
    },
    yAxis: {
      type: 'value', name: 'Desplazamiento (m)',
      nameTextStyle: { color: this.TXT }, axisLabel: { color: this.TXT },
      axisLine: { lineStyle: { color: '#cbd5e1' } }, splitLine: { lineStyle: { color: this.GRID } }
    },
    series: [
      { name: 'k = 12000 N/m', type: 'line', showSymbol: false, smooth: true, itemStyle: { color: this.K_COLORS[0] }, lineStyle: { width: 2 } },
      { name: 'k = 16000 N/m', type: 'line', showSymbol: false, smooth: true, itemStyle: { color: this.K_COLORS[1] }, lineStyle: { width: 2 } },
      { name: 'k = 20000 N/m', type: 'line', showSymbol: false, smooth: true, itemStyle: { color: this.K_COLORS[2] }, lineStyle: { width: 2 } }
    ]
  };

  // ── ECharts: Gráfica 3 — Error Relativo (log Y) ──────
  relErrOpts: EChartsOption = {
    backgroundColor: 'transparent',
    title: { text: 'Error Relativo (%)', textStyle: { color: '#1e293b', fontSize: 14, fontWeight: 'bold' } },
    tooltip: {
      trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#cbd5e1',
      textStyle: { color: '#1e293b', fontSize: 12 },
      formatter: (params: any) => {
        const items = Array.isArray(params) ? params : [params];
        let html = `t = ${items[0].data[0].toFixed(3)} s`;
        items.forEach((p: any) => {
          html += `<br/><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color};margin-right:4px;"></span>${p.seriesName}: ${p.data[1].toExponential(3)}%`;
        });
        return html;
      }
    },
    legend: {
      data: this.STEP_LABELS,
      bottom: 0, textStyle: { color: this.TXT, fontSize: 10 },
      itemWidth: 14, itemHeight: 10
    },
    grid: { left: '16%', right: '4%', top: '18%', bottom: '22%' },
    xAxis: {
      type: 'value', name: 'Tiempo (s)', nameLocation: 'middle', nameGap: 28,
      nameTextStyle: { color: this.TXT }, axisLabel: { color: this.TXT },
      axisLine: { lineStyle: { color: '#cbd5e1' } }, splitLine: { lineStyle: { color: this.GRID, type: 'dashed' } }
    },
    yAxis: {
      type: 'log', name: 'Error Relativo (%)',
      nameTextStyle: { color: this.TXT },
      axisLabel: { color: this.TXT, formatter: (v: number) => v.toExponential(0) },
      axisLine: { lineStyle: { color: '#cbd5e1' } }, splitLine: { lineStyle: { color: this.GRID } }
    },
    series: this.STEP_LABELS.map((label, idx) => ({
      name: label, type: 'line' as const, showSymbol: false, smooth: true,
      itemStyle: { color: this.STEP_COLORS[idx] },
      lineStyle: { width: 2 }
    }))
  };

  // ── ECharts: Gráfica 4 — Error Acumulativo (log Y) ───
  cumErrOpts: EChartsOption = {
    backgroundColor: 'transparent',
    title: { text: 'Error Acumulativo', textStyle: { color: '#1e293b', fontSize: 14, fontWeight: 'bold' } },
    tooltip: {
      trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#cbd5e1',
      textStyle: { color: '#1e293b', fontSize: 12 },
      formatter: (params: any) => {
        const items = Array.isArray(params) ? params : [params];
        let html = `t = ${items[0].data[0].toFixed(3)} s`;
        items.forEach((p: any) => {
          html += `<br/><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color};margin-right:4px;"></span>${p.seriesName}: ${p.data[1].toExponential(4)}`;
        });
        return html;
      }
    },
    legend: {
      data: this.STEP_LABELS,
      bottom: 0, textStyle: { color: this.TXT, fontSize: 10 },
      itemWidth: 14, itemHeight: 10
    },
    grid: { left: '16%', right: '4%', top: '18%', bottom: '22%' },
    xAxis: {
      type: 'value', name: 'Tiempo (s)', nameLocation: 'middle', nameGap: 28,
      nameTextStyle: { color: this.TXT }, axisLabel: { color: this.TXT },
      axisLine: { lineStyle: { color: '#cbd5e1' } }, splitLine: { lineStyle: { color: this.GRID, type: 'dashed' } }
    },
    yAxis: {
      type: 'log', name: 'Σ|Δx| (m)',
      nameTextStyle: { color: this.TXT },
      axisLabel: { color: this.TXT, formatter: (v: number) => v.toExponential(0) },
      axisLine: { lineStyle: { color: '#cbd5e1' } }, splitLine: { lineStyle: { color: this.GRID } }
    },
    series: this.STEP_LABELS.map((label, idx) => ({
      name: label, type: 'line' as const, showSymbol: false, smooth: true,
      itemStyle: { color: this.STEP_COLORS[idx] },
      lineStyle: { width: 2 }
    }))
  };

  timeMerge: EChartsOption = {};
  phaseMerge: EChartsOption = {};
  relErrMerge: EChartsOption = {};
  cumErrMerge: EChartsOption = {};

  // ── Efectos reactivos ─────────────────────────────────
  constructor() {
    // Actualizar las 4 gráficas cuando cambia el resultado de la simulación
    effect(() => {
      const r = this.sim.result();
      if (r.t.length === 0) return;

      // ── Gráfica 1: Respuesta Temporal ──
      const tr = r.timeResponse;
      if (tr.t.length > 0) {
        const analyticalData = tr.t.map((t, i) => [t, tr.xAnalytical[i]]);
        const rk4Series = tr.rk4Runs.map(run => ({
          data: tr.t.map((t, i) => [t, run.x[i]])
        }));
        this.timeMerge = {
          series: [
            { data: analyticalData },
            ...rk4Series
          ]
        };
      }

      // ── Gráfica 2: Sensibilidad a la Rigidez ──
      const sd = r.stiffnessData;
      if (sd.t.length > 0) {
        this.phaseMerge = {
          series: sd.series.map(s => ({
            data: sd.t.map((t, i) => [t, s.x[i]])
          }))
        };
      }

      // ── Gráfica 3: Error Relativo (log) ──
      const re = r.relErrData;
      if (re.series.length > 0) {
        this.relErrMerge = {
          series: re.series.map(s => ({
            data: s.t.map((t, i) => [t, s.error[i]])
          }))
        };
      }

      // ── Gráfica 4: Error Acumulativo (log) ──
      const ce = r.cumErrData;
      if (ce.series.length > 0) {
        this.cumErrMerge = {
          series: ce.series.map(s => ({
            data: s.t.map((t, i) => [t, s.cumError[i]])
          }))
        };
      }
    });

    // Cursor de tiempo sincronizado con la animación 3D
    effect(() => {
      const ct = this.sim.currentPlaybackTime();
      if (ct < 0) return; // sin reproducción

      const r = this.sim.result();
      const tr = r.timeResponse;
      if (tr.t.length === 0) return;

      const analyticalData = tr.t.map((t, i) => [t, tr.xAnalytical[i]]);
      const rk4Series = tr.rk4Runs.map(run => ({
        data: tr.t.map((t, i) => [t, run.x[i]])
      }));

      this.timeMerge = {
        series: [
          {
            data: analyticalData,
            markLine: {
              silent: true,
              symbol: ['none', 'none'],
              lineStyle: { color: '#0284c7', width: 2, type: 'solid' },
              label: { show: true, formatter: '{c} s', color: '#0284c7', fontSize: 11 },
              data: [{ xAxis: ct }]
            }
          },
          ...rk4Series
        ]
      };
    });
  }

  /* ─── Ciclo de vida ──────────────────────────────────── */

  ngOnInit(): void {
    this.runSim();
    this.sub = this.form.valueChanges.subscribe(() => this.runSim());
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private runSim(): void {
    const v = this.form.value;
    this.sim.runSimulation({
      m: Number(v.m),
      c: Number(v.c),
      k: Number(v.k),
      h: Number(v.h)
    });
  }

  onSimulate(): void {
    this.twin?.simulateImpact();
  }
}
