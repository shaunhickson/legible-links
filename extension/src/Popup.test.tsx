import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Popup from './Popup';

// Mock chrome API
const chromeMock = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
    }
  },
  tabs: {
    query: vi.fn(),
    reload: vi.fn(),
  },
  runtime: {
    openOptionsPage: vi.fn(),
  }
};

global.chrome = chromeMock as unknown as typeof chrome;

describe('Popup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly', async () => {
    // Mock storage get to return default
    chromeMock.storage.local.get.mockImplementation((keys, callback) => {
      callback({ 
        enabled: true, 
        domainList: [], 
        filterMode: 'blocklist', 
        matchSubdomains: true,
        apiUrl: 'https://test.com/resolve',
        theme: 'system'
      });
    });
    chromeMock.tabs.query.mockImplementation((query, callback) => {
        callback([{ url: 'https://example.com' }]);
    });

    await act(async () => {
        render(<Popup />);
    });
    
    expect(screen.getByText('Legible Links')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('toggles switch', async () => {
    chromeMock.storage.local.get.mockImplementation((keys, callback) => {
      callback({ 
        enabled: true, 
        domainList: [], 
        filterMode: 'blocklist', 
        matchSubdomains: true,
        apiUrl: 'https://test.com/resolve',
        theme: 'system'
      });
    });
    chromeMock.tabs.query.mockImplementation((query, callback) => {
        callback([{ id: 1, url: 'https://example.com' }]);
    });

    await act(async () => {
        render(<Popup />);
    });
    
    const checkboxes = screen.getAllByRole('checkbox');
    // Global toggle is the first one
    await act(async () => {
        fireEvent.click(checkboxes[0]);
    });
    
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false }),
        expect.any(Function)
    );
  });
});
