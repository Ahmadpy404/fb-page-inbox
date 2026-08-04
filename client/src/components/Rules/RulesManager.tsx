import React, { useState } from 'react';
import { Plus, Trash2, Edit3, ArrowUp, ArrowDown, Bot, Sparkles, CheckCircle2, XCircle } from 'lucide-react';
import { Rule, MatchType } from '../../types';

interface RulesManagerProps {
  rules: Rule[];
  onCreateRule: (rule: { keyword: string; matchType: MatchType; replyText: string; priority: number; enabled: boolean }) => Promise<void>;
  onUpdateRule: (id: string, updates: Partial<Rule>) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
  onReorderRules: (ruleIds: string[]) => Promise<void>;
}

export const RulesManager: React.FC<RulesManagerProps> = ({
  rules,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
  onReorderRules,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  // Form State
  const [keyword, setKeyword] = useState('');
  const [matchType, setMatchType] = useState<MatchType>('contains');
  const [replyText, setReplyText] = useState('');
  const [priority, setPriority] = useState<number>(0);
  const [enabled, setEnabled] = useState(true);

  // Live Test State
  const [testString, setTestString] = useState('');

  const openCreateModal = () => {
    setEditingRuleId(null);
    setKeyword('');
    setMatchType('contains');
    setReplyText('');
    setPriority(rules.length);
    setEnabled(true);
    setTestString('');
    setModalOpen(true);
  };

  const openEditModal = (rule: Rule) => {
    setEditingRuleId(rule.id);
    setKeyword(rule.keyword);
    setMatchType(rule.matchType);
    setReplyText(rule.replyText);
    setPriority(rule.priority);
    setEnabled(rule.enabled);
    setTestString('');
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim() || !replyText.trim()) return;

    if (editingRuleId) {
      await onUpdateRule(editingRuleId, {
        keyword: keyword.trim(),
        matchType,
        replyText: replyText.trim(),
        priority,
        enabled,
      });
    } else {
      await onCreateRule({
        keyword: keyword.trim(),
        matchType,
        replyText: replyText.trim(),
        priority,
        enabled,
      });
    }
    setModalOpen(false);
  };

  const moveRule = async (index: number, direction: 'up' | 'down') => {
    const newRules = [...rules];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newRules.length) return;

    const temp = newRules[index];
    newRules[index] = newRules[targetIndex];
    newRules[targetIndex] = temp;

    const ids = newRules.map((r) => r.id);
    await onReorderRules(ids);
  };

  // Test match logic
  const isMatch = (() => {
    if (!keyword.trim() || !testString.trim()) return null;
    const normTest = testString.trim().toLowerCase();
    const normKey = keyword.trim().toLowerCase();

    if (matchType === 'exact') return normTest === normKey;
    if (matchType === 'contains') return normTest.includes(normKey);
    if (matchType === 'regex') {
      try {
        const r = new RegExp(keyword.trim(), 'i');
        return r.test(testString.trim());
      } catch {
        return false;
      }
    }
    return false;
  })();

  return (
    <div className="rules-container">
      <header className="page-header">
        <div className="page-title-group">
          <h2>Auto-Reply Keyword Rules</h2>
          <p>Configure automated responses based on incoming user keywords and patterns.</p>
        </div>
        <button className="primary-btn" onClick={openCreateModal} id="btn-add-rule">
          <Plus size={16} />
          <span>New Auto-Reply Rule</span>
        </button>
      </header>

      <div className="rules-card">
        {rules.length === 0 ? (
          <div className="empty-state">
            <Bot size={40} color="var(--accent-primary)" />
            <h3>No auto-reply rules defined</h3>
            <p>Create rules to automatically respond to common questions like pricing, hours, or support.</p>
            <button className="primary-btn" style={{ marginTop: '16px' }} onClick={openCreateModal}>
              <Plus size={16} />
              Add First Rule
            </button>
          </div>
        ) : (
          <table className="rules-table">
            <thead>
              <tr>
                <th style={{ width: '80px' }}>Priority</th>
                <th>Keyword / Pattern</th>
                <th>Match Type</th>
                <th>Automated Reply</th>
                <th style={{ width: '90px' }}>Status</th>
                <th style={{ width: '130px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, idx) => (
                <tr key={rule.id} id={`rule-row-${rule.id}`}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-muted)' }}>#{idx + 1}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <button
                          className="icon-btn"
                          style={{ height: '16px', width: '16px' }}
                          disabled={idx === 0}
                          onClick={() => moveRule(idx, 'up')}
                          title="Move up priority"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          className="icon-btn"
                          style={{ height: '16px', width: '16px' }}
                          disabled={idx === rules.length - 1}
                          onClick={() => moveRule(idx, 'down')}
                          title="Move down priority"
                        >
                          <ArrowDown size={12} />
                        </button>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="keyword-code">{rule.keyword}</span>
                  </td>
                  <td>
                    <span className={`match-badge ${rule.matchType}`}>{rule.matchType}</span>
                  </td>
                  <td>
                    <div className="reply-snippet" title={rule.replyText}>
                      {rule.replyText}
                    </div>
                  </td>
                  <td>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => onUpdateRule(rule.id, { enabled: e.target.checked })}
                      />
                      <span className="slider" />
                    </label>
                  </td>
                  <td>
                    <div className="action-btn-group" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="icon-btn"
                        onClick={() => openEditModal(rule)}
                        title="Edit Rule"
                        id={`btn-edit-rule-${rule.id}`}
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        className="icon-btn danger"
                        onClick={() => onDeleteRule(rule.id)}
                        title="Delete Rule"
                        id={`btn-delete-rule-${rule.id}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <header className="modal-header">
              <h3>{editingRuleId ? 'Edit Auto-Reply Rule' : 'Create New Auto-Reply Rule'}</h3>
            </header>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Keyword or Pattern</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. pricing, hours, or ^order\s+\d+$"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  required
                  id="input-rule-keyword"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Match Type</label>
                <select
                  className="form-select"
                  value={matchType}
                  onChange={(e) => setMatchType(e.target.value as MatchType)}
                  id="select-rule-match-type"
                >
                  <option value="contains">Contains Substring (e.g. matches anywhere in message)</option>
                  <option value="exact">Exact Match (e.g. message equals keyword exactly)</option>
                  <option value="regex">Regular Expression (advanced pattern matching)</option>
                </select>
              </div>

              {/* Live Rule Tester */}
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', fontSize: '11px', color: '#818cf8', fontWeight: 600 }}>
                  <Sparkles size={13} />
                  <span>Interactive Pattern Tester</span>
                </div>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Type sample user message to test match..."
                  value={testString}
                  onChange={(e) => setTestString(e.target.value)}
                  style={{ fontSize: '12px', padding: '6px 10px' }}
                />
                {testString.trim() && (
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                    {isMatch ? (
                      <>
                        <CheckCircle2 size={14} color="#10b981" />
                        <span style={{ color: '#34d399', fontWeight: 600 }}>Matches! Rule would trigger reply.</span>
                      </>
                    ) : (
                      <>
                        <XCircle size={14} color="#ef4444" />
                        <span style={{ color: '#f87171' }}>Does not match.</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Automated Reply Text</label>
                <textarea
                  className="form-textarea"
                  placeholder="Enter the automated message response..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={3}
                  required
                  id="textarea-rule-reply"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px' }}>
                <span className="form-label">Rule Active</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>

              <footer className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn" id="btn-save-rule">
                  {editingRuleId ? 'Update Rule' : 'Create Rule'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
