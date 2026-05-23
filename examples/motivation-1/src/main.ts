import { createApp } from 'vue';
import { createInternationalization } from 'virtual:vue-internationalization';
import App from './App.vue';

const app = createApp(App);
const internationalization = createInternationalization({ initialLocale: navigator.language === 'ja-JP' ? 'ja-JP' : 'en-US' });

app.use(internationalization);
await internationalization.ready;
app.mount('#app');
