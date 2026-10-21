import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
  constructorArgs: [] as any[],
}));

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    isScanning = false;
    constructor(id: string) {
      mocks.constructorArgs.push(id);
    }
    async start(
      _camera: any,
      _config: any,
      onSuccess: (text: string) => void,
      onError: (err: any) => void,
    ) {
      mocks.start(onSuccess, onError);
      this.isScanning = true;
    }
    async stop() {
      this.isScanning = false;
      mocks.stop();
    }
    clear() {
      mocks.clear();
    }
  },
}));

const { default: QrScanner } = await import('./QrScanner');

function findButton(text: string) {
  return [...document.querySelectorAll('button')].find((b) =>
    (b.textContent || '').includes(text),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.start.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue(undefined);
  mocks.clear.mockReturnValue(undefined);
  document.body.innerHTML = '<div id="qr-reader-viewport"></div>';
});

describe('QrScanner', () => {
  it('reports a scan only once, even when the decoder fires repeatedly', async () => {
    const onScanSuccess = vi.fn();
    render(<QrScanner onScanSuccess={onScanSuccess} />);

    await act(async () => {
      findButton('Start QR Scanner')!.click();
    });

    const [onSuccess] = mocks.start.mock.calls[0] as any;

    // The decoder reports the same code on several consecutive frames.
    await act(async () => {
      onSuccess('token-a');
      onSuccess('token-a');
      onSuccess('token-a');
    });

    expect(onScanSuccess).toHaveBeenCalledTimes(1);
    expect(onScanSuccess).toHaveBeenCalledWith('token-a');
  });

  it('stops the camera once a code has been read', async () => {
    const onScanSuccess = vi.fn();
    render(<QrScanner onScanSuccess={onScanSuccess} />);

    await act(async () => {
      findButton('Start QR Scanner')!.click();
    });

    const [onSuccess] = mocks.start.mock.calls[0] as any;
    await act(async () => {
      onSuccess('token-a');
    });

    expect(mocks.stop).toHaveBeenCalled();
  });

  it('allows a new scan after the scanner has been started again', async () => {
    const onScanSuccess = vi.fn();
    render(<QrScanner onScanSuccess={onScanSuccess} />);

    await act(async () => {
      findButton('Start QR Scanner')!.click();
    });
    const [firstSuccess] = mocks.start.mock.calls[0] as any;
    await act(async () => {
      firstSuccess('token-a');
    });

    // Restart the scanner and scan a different code.
    await act(async () => {
      findButton('Start QR Scanner')!.click();
    });
    const [secondSuccess] = mocks.start.mock.calls[1] as any;
    await act(async () => {
      secondSuccess('token-b');
    });

    expect(onScanSuccess).toHaveBeenCalledTimes(2);
    expect(onScanSuccess).toHaveBeenLastCalledWith('token-b');
  });

  it('releases the camera when the student navigates away', async () => {
    const onScanSuccess = vi.fn();
    const view = render(<QrScanner onScanSuccess={onScanSuccess} />);

    await act(async () => {
      findButton('Start QR Scanner')!.click();
    });

    await act(async () => {
      view.unmount();
    });

    expect(mocks.stop).toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalled();
  });

  it('reports how long the camera took to become ready', async () => {
    const onScannerReady = vi.fn();
    render(<QrScanner onScanSuccess={vi.fn()} onScannerReady={onScannerReady} />);

    await act(async () => {
      findButton('Start QR Scanner')!.click();
    });

    expect(onScannerReady).toHaveBeenCalledTimes(1);
    expect(typeof onScannerReady.mock.calls[0][0]).toBe('number');
  });
});
