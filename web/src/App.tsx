import { Toaster } from 'sonner';
import AppLayout from './components/layout/AppLayout';

function App() {
  return (
    <>
      <Toaster position="bottom-right" theme="system" />
      <AppLayout />
    </>
  );
}

export default App;
