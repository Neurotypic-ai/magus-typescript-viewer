import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './client/App.vue';
import { initializePerformanceMonitoring } from './client/utils/performanceMonitoring';

// Initialize performance monitoring
initializePerformanceMonitoring();

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);

const rootElement = document.getElementById('app');
if (!rootElement) throw new Error('Failed to find app element');

app.mount(rootElement);
