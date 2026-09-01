import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MenuBar, type MenuActions } from './MenuBar';

function actions(): MenuActions {
  return {
    newDocument: vi.fn(), open: vi.fn(), save: vi.fn(), saveAs: vi.fn(),
    exportDocx: vi.fn(), exportTxt: vi.fn(), exportMd: vi.fn(), exportHtml: vi.fn(),
    find: vi.fn(), replace: vi.fn(), settings: vi.fn(), history: vi.fn(),
    toggleOutline: vi.fn(), toggleAI: vi.fn(), print: vi.fn()
  };
}

describe('MenuBar', () => {
  it('closes an open menu when the user interacts outside the menu bar', () => {
    render(<><MenuBar actions={actions()} /><button>编辑区外部</button></>);
    fireEvent.click(screen.getByText('文件'));
    const details = screen.getByText('文件').closest('details');
    expect(details?.open).toBe(true);

    fireEvent.pointerDown(screen.getByText('编辑区外部'));
    expect(details?.open).toBe(false);
  });

  it('keeps only one top-level menu open and closes on Escape', () => {
    render(<MenuBar actions={actions()} />);
    fireEvent.click(screen.getByText('文件'));
    const fileMenu = screen.getByText('文件').closest('details');
    fireEvent.click(screen.getByText('编辑'));
    const editMenu = screen.getByText('编辑').closest('details');
    expect(fileMenu?.open).toBe(false);
    expect(editMenu?.open).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(editMenu?.open).toBe(false);
  });
});
