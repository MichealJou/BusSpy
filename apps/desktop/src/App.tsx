import { I18nProvider } from "./i18n";
import { SerialConsoleView } from "./views/serial-console";

export function App() {
  return (
    <I18nProvider>
      <SerialConsoleView />
    </I18nProvider>
  );
}
