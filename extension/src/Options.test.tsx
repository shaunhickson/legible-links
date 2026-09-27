import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Options from './Options';

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
    },
  },
  runtime: {
    openOptionsPage: vi.fn(),
  },
};

global.chrome = chromeMock as unknown as typeof chrome;

async function mount(stored: Record<string, unknown> = {}) {
  chromeMock.storage.local.get.mockImplementation((_keys: unknown, callback: (items: Record<string, unknown>) => void) => {
    callback(stored);
  });
  chromeMock.storage.local.set.mockImplementation((_items: unknown, callback: () => void) => {
    callback();
  });
  await act(async () => {
    render(<Options />);
  });
}

describe('Options: privacy mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers three presets and selects Balanced by default', async () => {
    await mount();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(['private', 'balanced', 'everything', 'custom']);
    expect(radios.find((r) => r.value === 'balanced')?.checked).toBe(true);
    expect(screen.queryByLabelText(/YouTube, Spotify, X, Reddit, Vimeo/)).toBeNull();
  });

  it('says in one sentence what each preset sends, and to whom', async () => {
    await mount();
    expect(screen.getByText(/Nothing leaves your browser until you hover/)).toBeInTheDocument();
    expect(screen.getByText(/sent to the Legible Links server only while you hover it/)).toBeInTheDocument();
    expect(screen.getByText(/every other public link is sent to the Legible Links server automatically/)).toBeInTheDocument();
  });

  it('choosing Private saves platformMode hover and genericMode off', async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Private/ }));
    });
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ platformMode: 'hover', genericMode: 'off' }),
      expect.any(Function),
    );
  });

  it('shows Custom with the two selects when the stored combination matches no preset', async () => {
    await mount({ platformMode: 'hover', genericMode: 'auto' });
    expect((screen.getByRole('radio', { name: /Custom/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/YouTube, Spotify, X, Reddit, Vimeo/) as HTMLSelectElement).value).toBe('hover');
    expect((screen.getByLabelText(/Every other link/) as HTMLSelectElement).value).toBe('auto');

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Every other link/), { target: { value: 'off' } });
    });
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({ genericMode: 'off' }), expect.any(Function));
  });
});
