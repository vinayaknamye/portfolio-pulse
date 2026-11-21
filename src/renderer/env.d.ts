import type { PortfolioPulseApi } from '../preload/index';

declare global {
  interface Window {
    portfolioPulse: PortfolioPulseApi;
  }
}

export {};
