import { useStore } from '../store/StoreContext';
import { NewJobModal } from './NewJobModal';
import { StageModal } from '../pages/StagePage';
import { InspectModal } from '../pages/QCPage';
import { NewDispatchModal } from '../pages/DispatchPage';
import { InwardModal } from '../pages/RawInventoryPage';

/** Renders whichever shop-floor form was requested via openAction(), on top of any screen. */
export function ActionHost() {
  const { action, openAction } = useStore();
  if (!action) return null;
  const close = () => openAction(null);
  switch (action.kind) {
    case 'newJob':
      return <NewJobModal open onClose={close} />;
    case 'inward':
      return <InwardModal preset={action} onClose={close} />;
    case 'stage':
      return <StageModal key={action.jobNo + action.stage} stage={action.stage} jobNo={action.jobNo} onClose={close} />;
    case 'qc':
      return <InspectModal key={action.jobNo} jobNo={action.jobNo} onClose={close} />;
    case 'dispatch':
      return <NewDispatchModal key={action.fgId} fgId={action.fgId} onClose={close} />;
  }
}
