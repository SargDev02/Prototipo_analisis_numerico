import { Component } from '@angular/core';
import { SimulatorDashboardComponent } from './components/simulator-dashboard/simulator-dashboard.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [SimulatorDashboardComponent],
  template: `<app-simulator-dashboard></app-simulator-dashboard>`,
  styles: [`:host { display: block; }`]
})
export class App {}
