import type { ReactNode } from 'react';
import { useDies } from './DieContext';
import { PageFormCtx } from '../components/ui';
import { DieForm, DieView, IssueForm, MaintenanceForm, MainDieForm, ReplaceForm, ReturnForm } from './components';

/**
 * Renders the die form the address (or a pop-up request) asks for. <DieHost page /> sits inside the page area and shows the
 * full-page forms; the plain <DieHost /> only shows the die viewer, which stays a pop-up.
 */
export function DieHost({ page }: { page?: boolean }) {
  const { ui, openUI } = useDies();
  if (!ui) return null;
  const popup = ui.kind === 'die-view';
  if (!!page === popup) return null;
  const close = () => openUI(null);
  let body: ReactNode = null;
  switch (ui.kind) {
    case 'main-form':
      body = <MainDieForm key={ui.code ?? 'new'} code={ui.code} onClose={close} />;
      break;
    case 'die-form':
      body = <DieForm key={`${ui.dieKind}${ui.code ?? ui.mainCode ?? 'new'}`} kind={ui.dieKind} code={ui.code} mainCode={ui.mainCode} onClose={close} />;
      break;
    case 'die-view':
      body = <DieView key={ui.code} kind={ui.dieKind} code={ui.code} onClose={close} />;
      break;
    case 'replace':
      body = <ReplaceForm key={ui.code} kind={ui.dieKind} code={ui.code} onClose={close} />;
      break;
    case 'maintenance':
      body = <MaintenanceForm key={ui.code} kind={ui.dieKind} code={ui.code} onClose={close} />;
      break;
    case 'issue':
      body = <IssueForm key={ui.code} kind={ui.dieKind} code={ui.code} onClose={close} />;
      break;
    case 'return':
      body = <ReturnForm key={ui.code} kind={ui.dieKind} code={ui.code} onClose={close} />;
      break;
  }
  if (popup) return <>{body}</>;
  return <PageFormCtx.Provider value={{ eyebrow: 'Die Management' }}>{body}</PageFormCtx.Provider>;
}
