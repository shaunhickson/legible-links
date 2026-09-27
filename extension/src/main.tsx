import React from 'react'
import ReactDOM from 'react-dom/client'
import Popup from './Popup.tsx'
import Options from './Options.tsx'
import Onboarding from './Onboarding.tsx'

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement as HTMLElement).render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>,
  )
}

const optionsRoot = document.getElementById('options-root');
if (optionsRoot) {
  ReactDOM.createRoot(optionsRoot as HTMLElement).render(
    <React.StrictMode>
      <Options />
    </React.StrictMode>,
  )
}

const onboardingRoot = document.getElementById('onboarding-root');
if (onboardingRoot) {
  ReactDOM.createRoot(onboardingRoot as HTMLElement).render(
    <React.StrictMode>
      <Onboarding />
    </React.StrictMode>,
  )
}
