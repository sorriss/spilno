import { Component, computed, inject, resource, signal } from '@angular/core';
import {
  IonButton, IonContent, IonFooter, IonIcon, IonSpinner, NavController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { close } from 'ionicons/icons';
import { formatMoney, parseKopecks } from '../../core/money';
import { uk } from '../../i18n/uk';
import {
  computeShares, loadNewExpense, NewExpenseData, saveTransaction, ShareRow, SplitMode, TxType,
} from './new-expense.data';

/** Дата в локальном поясе: toISOString дал бы вчерашний день после полуночи по Киеву. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-new-expense',
  imports: [IonContent, IonFooter, IonIcon, IonSpinner, IonButton],
  templateUrl: './new-expense.page.html',
  styleUrl: './new-expense.page.scss',
})
export class NewExpensePage {
  private readonly nav = inject(NavController);

  protected readonly t = uk;
  protected readonly s = uk.newExpense;
  protected readonly data = resource({ loader: loadNewExpense });
  protected readonly types: TxType[] = ['expense', 'income', 'transfer'];
  protected readonly modes: SplitMode[] = ['equal', 'shares', 'amounts'];
  protected readonly maxDate = today();

  protected readonly type = signal<TxType>('expense');
  protected readonly amountText = signal('');
  protected readonly categoryId = signal('');
  protected readonly date = signal(today());
  protected readonly comment = signal('');
  protected readonly payer = signal<string | null>(null);
  protected readonly toMember = signal<string | null>(null);
  /** null: пользователь ещё не трогал переключатель, действует значение по умолчанию. */
  private readonly sharedChoice = signal<boolean | null>(null);
  protected readonly mode = signal<SplitMode>('equal');
  private readonly edits = signal<Record<string, Partial<ShareRow>>>({});
  protected readonly busy = signal(false);
  private readonly tried = signal(false);
  private readonly saveError = signal('');
  /** После первой попытки ошибка пересчитывается при вводе и исчезает, как только форма исправлена. */
  protected readonly error = computed(() => (this.tried() ? this.validate() : '') || this.saveError());

  private readonly loaded = computed(() => (this.data.hasValue() ? this.data.value() : null));
  protected readonly multiple = computed(() => (this.loaded()?.members.length ?? 0) > 1);
  protected readonly shared = computed(() => this.type() === 'expense' && (this.sharedChoice() ?? this.multiple()));
  protected readonly categories = computed(() => {
    const type = this.type();
    return this.loaded()?.categories.filter((c) => c.kind === type) ?? [];
  });
  protected readonly recipients = computed(() => {
    const d = this.loaded();
    return d?.members.filter((m) => m.id !== d.meId) ?? [];
  });
  protected readonly amount = computed(() => parseKopecks(this.amountText()) ?? 0);
  protected readonly rows = computed<ShareRow[]>(() =>
    (this.loaded()?.members ?? []).map((m) => ({
      memberId: m.id, on: true, weight: '1', amount: '', ...this.edits()[m.id],
    })),
  );
  protected readonly shares = computed(() => computeShares(this.amount(), this.mode(), this.rows()));
  private readonly left = computed(() => {
    const shares = this.shares();
    return shares ? this.amount() - shares.reduce((sum, s) => sum + s.amount, 0) : 0;
  });
  protected readonly status = computed(() => {
    const left = this.left();
    if (this.mode() !== 'amounts' || !this.shares()) return '';
    if (left > 0) return this.s.unallocated(formatMoney(left));
    if (left < 0) return this.s.overallocated(formatMoney(-left));
    return this.amount() ? this.s.allocated(formatMoney(this.amount())) : '';
  });
  protected readonly statusBad = computed(() => this.left() !== 0);

  constructor() {
    addIcons({ close });
  }

  protected shareOf(memberId: string): number | null {
    return this.shares()?.find((s) => s.memberId === memberId)?.amount ?? null;
  }

  protected money(kopecks: number): string {
    return formatMoney(kopecks);
  }

  protected isMe(d: NewExpenseData, memberId: string): boolean {
    return d.meId === memberId;
  }

  protected pickType(type: TxType): void {
    this.type.set(type);
    this.categoryId.set(''); // у дохода и расхода разные категории
  }

  protected setShared(value: boolean): void {
    this.sharedChoice.set(value);
  }

  protected edit(memberId: string, patch: Partial<ShareRow>): void {
    this.edits.update((all) => ({ ...all, [memberId]: { ...all[memberId], ...patch } }));
  }

  /** Сумма после ввода приводится к виду «1 248,60 ₴». */
  protected tidyAmount(): void {
    if (this.amount() > 0) this.amountText.set(formatMoney(this.amount()));
  }

  private validate(): string {
    if (this.amount() <= 0) return this.s.errorAmount;
    if (!this.date() || this.date() > today()) return this.s.errorDate;
    if (this.type() === 'transfer' && !this.toMember()) return this.s.errorRecipient;
    if (this.shared()) {
      if (!this.shares()?.length) return this.s.errorShares;
      if (this.left() !== 0) return this.s.errorAllocated;
    }
    return '';
  }

  protected async save(d: NewExpenseData): Promise<void> {
    if (this.busy()) return;
    this.tried.set(true);
    this.saveError.set('');
    if (this.validate()) return;

    const shared = this.shared();
    const [y, m, day] = this.date().split('-').map(Number);
    this.busy.set(true);
    try {
      await saveTransaction({
        familyId: d.familyId,
        type: this.type(),
        amount: this.amount(),
        // Сегодняшняя операция встаёт в списке сверху, у прошлой даты время не важно.
        occurredAt: this.date() === today() ? new Date() : new Date(y, m - 1, day, 12),
        comment: this.comment().trim() || null,
        categoryId: this.type() === 'transfer' ? null : this.categoryId() || null,
        // Личную операцию и перевод схема записывает только на самого автора.
        paidBy: shared ? (this.payer() ?? d.meId) : d.meId,
        toMember: this.type() === 'transfer' ? this.toMember() : null,
        mode: shared ? this.mode() : null,
        shares: shared ? this.shares()! : [],
      });
      await this.nav.navigateBack('/tabs/overview');
    } catch {
      this.saveError.set(this.s.errorSave);
    } finally {
      this.busy.set(false);
    }
  }

  protected closePage(): void {
    this.nav.navigateBack('/tabs/overview');
  }
}
