import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Globe, Check, Layers } from 'lucide-react';
import { PageData } from '../../types';

interface PageSelectorProps {
  pages: PageData[];
  selectedPageId: string; // 'all' or specific page.id
  onSelectPage: (pageId: string) => void;
  onOpenAddModal: () => void;
}

export const PageSelector: React.FC<PageSelectorProps> = ({
  pages,
  selectedPageId,
  onSelectPage,
  onOpenAddModal,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activePage = pages.find((p) => p.id === selectedPageId);
  const totalUnread = pages.reduce((acc, p) => acc + (p.unreadConversations || 0), 0);

  return (
    <div className="page-selector-container" ref={dropdownRef}>
      <button
        className="page-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title="Switch Facebook Page"
        id="btn-page-selector"
      >
        <div className="page-avatar-badge">
          {activePage?.pictureUrl ? (
            <img src={activePage.pictureUrl} alt={activePage.name} className="page-avatar-img" />
          ) : selectedPageId === 'all' ? (
            <Layers size={16} color="var(--accent-primary)" />
          ) : (
            <Globe size={16} color="var(--accent-primary)" />
          )}
          <span className="online-indicator-dot" />
        </div>

        <div className="page-info-preview">
          <span className="page-name-text">
            {selectedPageId === 'all' ? 'All Pages (Unified)' : activePage?.name || 'Select Page'}
          </span>
          <span className="page-subtext">
            {pages.length} {pages.length === 1 ? 'Page Connected' : 'Pages Connected'}
          </span>
        </div>

        <ChevronDown size={14} className={`chevron-icon ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="page-selector-dropdown">
          <div className="dropdown-header">
            <span>SWITCH FACEBOOK PAGE</span>
            {totalUnread > 0 && <span className="unread-pill">{totalUnread} new</span>}
          </div>

          <div className="dropdown-list">
            {/* Unified Feed Option */}
            <div
              className={`dropdown-item ${selectedPageId === 'all' ? 'active' : ''}`}
              onClick={() => {
                onSelectPage('all');
                setIsOpen(false);
              }}
            >
              <div className="dropdown-item-left">
                <div className="item-icon-box">
                  <Layers size={16} />
                </div>
                <div className="item-details">
                  <div className="item-name">All Connected Pages</div>
                  <div className="item-meta">Unified inbox from all pages</div>
                </div>
              </div>
              {selectedPageId === 'all' && <Check size={16} className="check-icon" />}
            </div>

            {/* Individual Pages */}
            {pages.map((page) => (
              <div
                key={page.id}
                className={`dropdown-item ${selectedPageId === page.id ? 'active' : ''}`}
                onClick={() => {
                  onSelectPage(page.id);
                  setIsOpen(false);
                }}
              >
                <div className="dropdown-item-left">
                  <div className="item-avatar-box">
                    {page.pictureUrl ? (
                      <img src={page.pictureUrl} alt={page.name} />
                    ) : (
                      <span>{page.name.slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="item-details">
                    <div className="item-name">{page.name}</div>
                    <div className="item-meta">ID: {page.pageId}</div>
                  </div>
                </div>

                <div className="dropdown-item-right">
                  {(page.unreadConversations || 0) > 0 && (
                    <span className="unread-counter">{page.unreadConversations}</span>
                  )}
                  {selectedPageId === page.id && <Check size={16} className="check-icon" />}
                </div>
              </div>
            ))}
          </div>

          <div className="dropdown-footer">
            <button
              className="add-page-btn"
              onClick={() => {
                setIsOpen(false);
                onOpenAddModal();
              }}
              id="btn-open-add-page-modal"
            >
              <Plus size={15} />
              <span>Connect Another Page</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
