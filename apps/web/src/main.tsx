import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/style.css';
import './styles/workspace.css';
import './styles/auth-design.css';
import './styles/workspace-sand.css';
import './features/ai/ai.css';

createRoot(document.getElementById('root')!).render(<App />);
