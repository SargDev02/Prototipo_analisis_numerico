import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideEchartsCore } from 'ngx-echarts';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideEchartsCore({ echarts: () => import('echarts') }),
  ],
};
