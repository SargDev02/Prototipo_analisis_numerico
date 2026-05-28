import {
  Component, ElementRef, OnInit, OnDestroy,
  ViewChild, inject, effect
} from '@angular/core';
import * as THREE from 'three';
import { SimulationService } from '../../services/simulation.service';

/**
 * Curva paramétrica helicoidal para el resorte.
 * Genera un espiral que crece de arriba hacia abajo.
 */
class HelixCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    public radius: number,
    public turns: number,
    public height: number
  ) {
    super();
  }

  override getPoint(t: number, optionalTarget = new THREE.Vector3()): THREE.Vector3 {
    const angle = t * Math.PI * 2 * this.turns;
    const px = Math.cos(angle) * this.radius;
    const pz = Math.sin(angle) * this.radius;
    const py = -t * this.height;
    return optionalTarget.set(px, py, pz);
  }
}

@Component({
  selector: 'app-digital-twin-3d',
  standalone: true,
  template: `
    <div #canvasContainer
         style="width:100%; height:100%; min-height:300px; border-radius:12px; overflow:hidden; position:relative;">
    </div>
  `,
  styles: [`:host { display: block; width: 100%; height: 100%; }`]
})
export class DigitalTwin3DComponent implements OnInit, OnDestroy {
  @ViewChild('canvasContainer', { static: true })
  canvasContainer!: ElementRef<HTMLDivElement>;

  private sim = inject(SimulationService);

  // Three.js core
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private resizeObs!: ResizeObserver;
  private rafId: number | null = null;

  // Objetos 3D
  private massMesh!: THREE.Mesh;
  private springMesh!: THREE.Mesh;
  private damperOuter!: THREE.Mesh;
  private damperInner!: THREE.Mesh;

  // Materiales (guardados para dispose)
  private materials: THREE.Material[] = [];

  // Constantes de layout
  private readonly SCALE = 20;        // 0.05 m → 1 unidad Three.js
  private readonly ANCHOR_Y = 4;      // Soporte fijo arriba
  private readonly REST_Y = 0;        // Posición de equilibrio de la masa
  private readonly SPRING_R = 0.35;   // Radio del helicoide
  private readonly SPRING_TURNS = 8;  // Espiras
  private readonly WIRE_R = 0.055;    // Radio del alambre

  // Animación
  private ready = false;
  private playing = false;
  private animStart = 0;

  constructor() {
    // Reaccionar a cambios de parámetros → resetear posición al valor inicial
    effect(() => {
      const r = this.sim.result();
      if (this.ready && !this.playing && r.x.length > 0) {
        this.setDisplacement(r.x[0]);
      }
    });
  }

  /* ─── Ciclo de vida Angular ──────────────────────────── */

  ngOnInit(): void {
    this.initScene();
    this.buildModel();
    this.ready = true;

    // Posición inicial desde la simulación
    const r = this.sim.result();
    if (r.x.length > 0) {
      this.setDisplacement(r.x[0]);
    } else {
      this.setDisplacement(0.05);
    }

    this.render();
    this.setupResize();
  }

  ngOnDestroy(): void {
    this.resizeObs?.disconnect();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);

    // Dispose completo
    this.scene?.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
      }
    });
    this.materials.forEach(m => m.dispose());
    this.renderer?.dispose();
  }

  /* ─── Escena Three.js ────────────────────────────────── */

  private initScene(): void {
    const el = this.canvasContainer.nativeElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe8ecf1);

    this.camera = new THREE.PerspectiveCamera(
      42, el.clientWidth / Math.max(el.clientHeight, 1), 0.1, 100
    );
    this.camera.position.set(0, 1.5, 10);
    this.camera.lookAt(0, 1.2, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    el.appendChild(this.renderer.domElement);

    // Luces
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    const dir = new THREE.DirectionalLight(0xffffff, 1.8);
    dir.position.set(5, 10, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    this.scene.add(dir);

    const blue = new THREE.PointLight(0x38bdf8, 3, 25);
    blue.position.set(-4, 1, 4);
    this.scene.add(blue);

    const purple = new THREE.PointLight(0xa855f7, 2, 25);
    purple.position.set(4, -1, 4);
    this.scene.add(purple);
  }

  private makeMat(color: number, metalness: number, roughness: number): THREE.MeshPhysicalMaterial {
    const m = new THREE.MeshPhysicalMaterial({ color, metalness, roughness, clearcoat: 0.4, clearcoatRoughness: 0.2 });
    this.materials.push(m);
    return m;
  }

  private buildModel(): void {
    const matMetal = this.makeMat(0x94a3b8, 0.85, 0.2);
    const matDark  = this.makeMat(0x334155, 0.9, 0.35);
    const matBlue  = this.makeMat(0x0ea5e9, 0.65, 0.25);

    // Soporte superior fijo
    const supportGeo = new THREE.BoxGeometry(4.5, 0.3, 2);
    const support = new THREE.Mesh(supportGeo, matDark);
    support.position.y = this.ANCHOR_Y;
    support.castShadow = true;
    support.receiveShadow = true;
    this.scene.add(support);

    // Resorte helicoidal
    const initLength = this.ANCHOR_Y - this.REST_Y;
    const helixCurve = new HelixCurve(this.SPRING_R, this.SPRING_TURNS, initLength);
    const springGeo = new THREE.TubeGeometry(helixCurve, 120, this.WIRE_R, 10, false);
    this.springMesh = new THREE.Mesh(springGeo, matMetal);
    this.springMesh.position.set(-0.9, this.ANCHOR_Y, 0);
    this.springMesh.castShadow = true;
    this.scene.add(this.springMesh);

    // Amortiguador exterior (fijo al soporte, crece hacia abajo)
    const outerGeo = new THREE.CylinderGeometry(0.28, 0.28, 2.2, 24);
    outerGeo.translate(0, -1.1, 0);
    this.damperOuter = new THREE.Mesh(outerGeo, matDark);
    this.damperOuter.position.set(0.9, this.ANCHOR_Y, 0);
    this.damperOuter.castShadow = true;
    this.scene.add(this.damperOuter);

    // Amortiguador interior (conectado a la masa, crece hacia arriba)
    const innerGeo = new THREE.CylinderGeometry(0.15, 0.15, 2.2, 24);
    innerGeo.translate(0, 1.1, 0);
    this.damperInner = new THREE.Mesh(innerGeo, matMetal);
    this.damperInner.position.set(0.9, this.REST_Y, 0);
    this.damperInner.castShadow = true;
    this.scene.add(this.damperInner);

    // Masa (bloque)
    const massGeo = new THREE.BoxGeometry(2.8, 1.0, 1.6);
    this.massMesh = new THREE.Mesh(massGeo, matBlue);
    this.massMesh.castShadow = true;
    this.massMesh.receiveShadow = true;
    this.scene.add(this.massMesh);

    // Grid con desvanecimiento
    const grid = new THREE.GridHelper(24, 24, 0x0284c7, 0xcbd5e1);
    grid.position.y = -2.5;
    (grid.material as THREE.LineBasicMaterial).transparent = true;
    (grid.material as THREE.LineBasicMaterial).opacity = 0.25;
    this.scene.add(grid);
  }

  /* ─── Posicionamiento visual ─────────────────────────── */

  private setDisplacement(xMeters: number): void {
    // xMeters positivo = masa desplazada hacia abajo desde el equilibrio
    const visualY = this.REST_Y - xMeters * this.SCALE;

    // Masa (centro del bloque)
    this.massMesh.position.y = visualY - 0.5;

    // Amortiguador interior
    this.damperInner.position.y = visualY;

    // Resorte: regenerar geometría paramétrica
    const springLen = Math.max(0.5, this.ANCHOR_Y - visualY);
    const curve = new HelixCurve(this.SPRING_R, this.SPRING_TURNS, springLen);
    const newGeo = new THREE.TubeGeometry(curve, 120, this.WIRE_R, 10, false);
    this.springMesh.geometry.dispose();
    this.springMesh.geometry = newGeo;
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /* ─── Resize Observer ────────────────────────────────── */

  private setupResize(): void {
    const el = this.canvasContainer.nativeElement;
    this.resizeObs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0 && h > 0) {
          this.camera.aspect = w / h;
          this.camera.updateProjectionMatrix();
          this.renderer.setSize(w, h);
          if (!this.playing) this.render();
        }
      }
    });
    this.resizeObs.observe(el);
  }

  /* ─── Animación de impacto ───────────────────────────── */

  public simulateImpact(): void {
    if (this.playing) return;
    const r = this.sim.result();
    if (r.t.length === 0) return;

    this.playing = true;
    this.animStart = performance.now();
    const duration = r.t[r.t.length - 1]; // 5 s

    const tick = (now: number) => {
      let elapsed = (now - this.animStart) / 1000;
      if (elapsed >= duration) {
        elapsed = duration;
        this.playing = false;
      }

      // Buscar índice más cercano e interpolar
      const frac = elapsed / duration;
      const rawIdx = frac * (r.t.length - 1);
      const i = Math.min(Math.floor(rawIdx), r.t.length - 2);
      const alpha = rawIdx - i;
      const disp = r.x[i] + alpha * (r.x[i + 1] - r.x[i]);

      this.setDisplacement(disp);
      this.render();
      this.sim.currentPlaybackTime.set(elapsed);

      if (this.playing) {
        this.rafId = requestAnimationFrame(tick);
      }
    };

    this.rafId = requestAnimationFrame(tick);
  }
}
