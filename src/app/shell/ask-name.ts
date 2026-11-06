import { AlertController } from '@ionic/angular';
import { uk } from '../i18n/uk';

/** Окно с одним полем названия. Пустое значение окно не закрывает. */
export async function askName(
  alerts: AlertController,
  header: string,
  value: string,
  onSave: (name: string) => void,
): Promise<void> {
  const alert = await alerts.create({
    header,
    inputs: [{ name: 'name', type: 'text', value, attributes: { maxlength: 60, 'aria-label': header } }],
    buttons: [
      { text: uk.cancel, role: 'cancel' },
      {
        text: uk.save,
        handler: ({ name }: { name: string }) => {
          if (!name.trim()) return false;
          onSave(name.trim());
          return true;
        },
      },
    ],
  });
  await alert.present();
}

/** Подтверждение необратимого или заметного действия. */
export async function askConfirm(
  alerts: AlertController,
  header: string,
  message: string,
  action: string,
  onConfirm: () => void,
): Promise<void> {
  const alert = await alerts.create({
    header,
    message,
    buttons: [
      { text: uk.cancel, role: 'cancel' },
      { text: action, role: 'destructive', handler: onConfirm },
    ],
  });
  await alert.present();
}
