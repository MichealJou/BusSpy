import { I18nProvider } from "./i18n";
import { UpdateChecker } from "./components/update/UpdateChecker";
import { SerialConsoleView } from "./views/serial-console";

export function App() {
  return (
    <I18nProvider>
      <UpdateChecker />
      <SerialConsoleView />
    </I18nProvider>
  );
}
