import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// Config comes from frontend/.env.<stage>, written by `npm run outputs -- <stage>` from the stack outputs.
// Nothing is hardcoded: the build fails if a value is missing.
const NEEDED = ['ApiUrl', 'AppClientId', 'CognitoDomain'] as const;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const name of NEEDED) {
    if (!env[name]) throw new Error(`Missing ${name} in frontend/.env.${mode}. Run: npm run outputs -- ${mode}`);
  }
  return {
    plugins: [react()],
    define: {
      __API_URL__: JSON.stringify(env.ApiUrl.replace(/\/+$/, '')),
      __CLIENT_ID__: JSON.stringify(env.AppClientId),
      __COGNITO_DOMAIN__: JSON.stringify(env.CognitoDomain),
    },
  };
});
