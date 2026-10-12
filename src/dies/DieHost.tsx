import { useDies } from './DieContext';
import { DieForm, DieView, IssueForm, MaintenanceForm, MainDieForm, ReplaceForm, ReturnForm } from './components';

/** Renders whichever die form / viewer is open, wherever the user is. */
export function DieHost() {
  const { ui, openUI } = useDies();
  if (!ui) return null;
  const close = () => openUI(null);
  switch (ui.kind) {
    case 'main-form':
      return <MainDieForm key={ui.code ?? 'new'} code={ui.code} onClose={close} />;
    case 'die-form':
      return <DieForm key={`${ui.dieKind}${ui.code ?? ui.mainCode ?? 'new'}`} kind={ui.dieKind} code={ui.code} mainCode={ui.mainCode} onClose={close} />;
    case 'die-view':
      return <DieView key={ui.code} kind={ui.dieKind} code={ui.code} onClose={close} />;
    case 'replace':
      return <ReplaceForm key={ui.code} kind={ui.dieKind} code={ui.code} onClose={close} />;
    case 'maintenance':
      return <MaintenanceForm key={ui.code} kind={ui.dieKind} code={ui.code} onClose={close} />;
    case 'issue':
      return <IssueForm key={ui.code} kind={ui.dieKind} code={ui.code} onClose={close} />;
    case 'return':
      return <ReturnForm key={ui.code} kind={ui.dieKind} code={ui.code} onClose={close} />;
  }
}
