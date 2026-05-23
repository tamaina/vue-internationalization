import { createApp } from 'vue';
import { createI18n } from 'virtual:vue-internationalization';
import App from './App.vue';

const app = createApp(App);
const i18n = createI18n({ initialLocale: navigator.language === 'ja-JP' ? 'ja-JP' : 'en-US' });

app.use(i18n);
await i18n.ready;
app.mount('#app');
