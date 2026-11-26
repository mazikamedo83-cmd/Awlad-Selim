import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { formatCountdownMmSs, formatMobileSyncTimestamp } from '../../../services/syncEngine';
import { syncNativeStatusBarStyle } from '../../../services/native';

interface MobileSendReceiveScreenProps {
  onBack?: () => void;
}

export const MobileSendReceiveScreen: React.FC<MobileSendReceiveScreenProps> = ({ onBack }) => {
  const data = useData();
  const { t, dir, isRtl } = usePreferences();
  const [isSending, setIsSending] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    syncNativeStatusBarStyle('dark-header');
  }, []);

  useEffect(() => {
    if (!onBack) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBack]);

  const unsentCount = data.pendingSyncCount;
  const lastSendFmt = formatMobileSyncTimestamp(data.lastSendSummary?.at);
  const lastReceiveFmt = formatMobileSyncTimestamp(data.lastReceiveSummary?.at);

  const isBusy = isSending || isReceiving || data.isMandatorySending;

  const handleSend = async () => {
    if (isBusy) return;
    setErrorMsg(null);
    setIsSending(true);
    try {
      const res = await data.syncSendOnly({ includeHeldBatches: true });
      if (!res.ok || res.failedCount > 0 || res.conflictCount > 0) {
        setErrorMsg(
          res.error
            ? t(res.error)
            : t(
                'تعذر إرسال بعض العمليات — تم الاحتفاظ بالبيانات محلياً لإعادة المحاولة',
                'Failed to send some operations — data retained locally for retry'
              )
        );
      } else {
        setErrorMsg(null);
      }
    } catch (err: any) {
      setErrorMsg(err?.message ? t(err.message) : t('تعذر الاتصال بالسيرفر لإرسال العمليات', 'Unable to connect to server to send operations'));
    } finally {
      setIsSending(false);
    }
  };

  const handleReceive = async () => {
    if (isBusy) return;
    setErrorMsg(null);
    setIsReceiving(true);
    try {
      const res = await data.syncReceiveOnly();
      if (!res.ok) {
        setErrorMsg(res.error ? t(res.error) : t('تعذر استلام التحديثات حالياً', 'Unable to receive updates right now'));
      } else {
        setErrorMsg(null);
      }
    } catch (err: any) {
      setErrorMsg(err?.message ? t(err.message) : t('تعذر الاتصال للاستلام', 'Unable to connect to receive'));
    } finally {
      setIsReceiving(false);
    }
  };

  const countdownText =
    data.mandatorySendEnabled && !data.isMandatorySending
      ? formatCountdownMmSs(data.mandatorySendRemainingSeconds)
      : '00:00';

  const sendButtonLabel =
    isSending || data.isMandatorySending
      ? data.sendProgressPercent > 0
        ? `${t('جاري الإرسال', 'Sending')} (${formatLocaleNumber(data.sendProgressPercent)}%)...`
        : t('جاري الإرسال...', 'Sending...')
      : t('إرسال', 'Send');

  const receiveButtonLabel = isReceiving
    ? data.receiveProgressPercent > 0
      ? `${t('جاري الاستلام', 'Receiving')} (${formatLocaleNumber(data.receiveProgressPercent)}%)...`
      : t('جاري الاستلام...', 'Receiving...')
    : t('استلام', 'Receive');

  const BackIcon = isRtl ? ArrowLeft : ArrowRight;

  return (
    <div
      dir={dir}
      data-testid="mobile-send-receive-screen"
      className="fixed inset-0 z-[55] no-dark-surface bg-[#FFFFFF] dark:bg-[#FFFFFF] text-[#111111] dark:text-[#111111] font-['Cairo',sans-serif] flex flex-col overflow-y-auto pb-safe"
    >
      {/* Top Royal Navy Header Bar (#1e3a8a) */}
      <header
        dir="ltr"
        className="w-full shrink-0 bg-[#1e3a8a] dark:bg-[#1e3a8a] pt-safe"
      >
        <div className="h-12 px-3 flex items-center justify-start">
          <button
            type="button"
            data-testid="mobile-send-receive-back-btn"
            onClick={() => onBack?.()}
            aria-label={t('رجوع', 'Back')}
            className="w-10 h-10 flex items-center justify-center text-white dark:text-white rounded-full active:bg-white/15 cursor-pointer"
          >
            <BackIcon className="w-6 h-6" strokeWidth={2.5} />
          </button>
        </div>
      </header>

      {/* Main White Content Column */}
      <main className="w-full max-w-md mx-auto px-3.5 pt-3 pb-6 flex flex-col items-stretch">
        {/* 1. Last Send Gray Bar */}
        <div
          data-testid="sync-last-send"
          className="w-full bg-[#CCCCCC] dark:bg-[#CCCCCC] text-[#111111] dark:text-[#111111] text-[15px] leading-snug font-medium py-1.5 px-3 text-center"
        >
          {lastSendFmt
            ? `${t('آخر إرسال في', 'Last sent at')} ${lastSendFmt.fullText}`
            : t('آخر إرسال: لم يتم الإرسال بعد', 'Last Send: Not sent yet')}
        </div>

        {/* 2. Pending Operations Count Gray Bar */}
        <div
          data-testid="sync-pending-ops-count"
          className="mt-2.5 w-full bg-[#CCCCCC] dark:bg-[#CCCCCC] text-[#111111] dark:text-[#111111] text-[15px] leading-snug font-medium py-1.5 px-3 text-center tabular-nums"
        >
          {`${t('عدد العمليات المعلقة', 'Pending Operations Count')} ${formatLocaleNumber(unsentCount)}`}
        </div>

        {/* 3. Dark Blue Send Button (#000080) */}
        <button
          type="button"
          data-testid="mobile-send-btn"
          disabled={isBusy}
          onClick={handleSend}
          className="mt-3 w-full min-h-[48px] rounded-[8px] bg-[#000080] dark:bg-[#000080] hover:bg-[#00006B] active:opacity-90 disabled:opacity-60 text-white dark:text-white text-[17px] font-bold flex items-center justify-center cursor-pointer transition-opacity"
        >
          {sendButtonLabel}
        </button>

        {/* 4. Last Receive Gray Bar */}
        <div
          data-testid="sync-last-receive"
          className="mt-6 w-full bg-[#CCCCCC] dark:bg-[#CCCCCC] text-[#111111] dark:text-[#111111] text-[15px] leading-snug font-medium py-1.5 px-3 text-center"
        >
          {lastReceiveFmt
            ? `${t('آخر استلام في', 'Last received at')} ${lastReceiveFmt.fullText}`
            : t('آخر استلام: لم يتم الاستلام بعد', 'Last Receive: Not received yet')}
        </div>

        {/* 5. Green Receive Button (#008000) */}
        <button
          type="button"
          data-testid="mobile-receive-btn"
          disabled={isBusy}
          onClick={handleReceive}
          className="mt-3 w-full min-h-[48px] rounded-[8px] bg-[#008000] dark:bg-[#008000] hover:bg-[#006B00] active:opacity-90 disabled:opacity-60 text-white dark:text-white text-[17px] font-bold flex items-center justify-center cursor-pointer transition-opacity"
        >
          {receiveButtonLabel}
        </button>

        {/* 6. Mandatory Send Label Gray Bar */}
        <div className="mt-7 w-full bg-[#CCCCCC] dark:bg-[#CCCCCC] text-[#111111] dark:text-[#111111] text-[15px] leading-snug font-medium py-1.5 px-3 text-center">
          {t('الإرسال الإجباري بعد', 'Mandatory Send In')}
        </div>

        {/* 7. Large Bold Black Countdown Digits */}
        <div
          dir="ltr"
          data-testid="sync-mandatory-countdown"
          className="mt-4 text-center text-[42px] leading-none font-bold text-black dark:text-black tabular-nums tracking-wide"
        >
          {countdownText}
        </div>

        {/* Minimal inline error line shown ONLY on actual error */}
        {errorMsg && (
          <p
            role="alert"
            data-testid="mobile-send-receive-error"
            className="mt-4 text-center text-xs font-bold text-red-700 dark:text-red-700"
          >
            {errorMsg}
          </p>
        )}
      </main>
    </div>
  );
};
