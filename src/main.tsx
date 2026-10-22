import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './plans.css';
const root = document.getElementById('root')!;
const app = <React.StrictMode><App /></React.StrictMode>;
if (root.hasChildNodes() && !new URLSearchParams(location.search).has('demo')) ReactDOM.hydrateRoot(root, app);
else ReactDOM.createRoot(root).render(app);
