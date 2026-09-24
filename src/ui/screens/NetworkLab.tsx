import { useQueryClient } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { DEFAULT_TIMEOUT_MS } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { resetMockServer, scenarioStore, setScenario } from '../../mocks/browser';
import { SCENARIOS } from '../../mocks/scenarios';
import { readNumber, removeKey } from '../../state/storage';
import { Dialog, MenuButton } from '../components';

/**
 * Demo/QA panel to pick a mock API scenario. The choice is persisted, so it
 * also survives refreshes (e.g. "fail at match end, refresh, recover").
 * It can also be set with ?scenario=<id> in the URL.
 */
export function NetworkLab({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const { id, failed } = useSyncExternalStore(scenarioStore.subscribe, scenarioStore.getSnapshot);
  const [timeoutMs, setTimeoutMs] = useState(() => readNumber('pb.api.timeoutMs', DEFAULT_TIMEOUT_MS));
  const [notice, setNotice] = useState('');

  const refresh = () => {
    void client.invalidateQueries({ queryKey: queryKeys.rankingAll });
    void client.invalidateQueries({ queryKey: queryKeys.historyAll });
  };

  return (
    <Dialog open={open} labelledBy="lab-title" describedBy="lab-text" onCancel={onClose} className="lab-dialog" testId="network-lab">
      <h2 id="lab-title" className="panel-title panel-title--sm">
        Network Lab
      </h2>
      <p id="lab-text" className="lab-text">
        The ranking and history APIs are simulated with MSW. Pick how the fake server behaves.
        {failed && ' The mock service worker could not start in this browser, so every request fails.'}
      </p>
      <fieldset className="lab-scenarios">
        <legend className="visually-hidden">Scenario</legend>
        {SCENARIOS.map((s) => (
          <label key={s.id} className={`lab-option ${s.id === id ? 'is-active' : ''}`}>
            <input
              type="radio"
              name="scenario"
              value={s.id}
              checked={s.id === id}
              onChange={() => {
                setScenario(s.id);
                setNotice(`Scenario "${s.label}" active.`);
                refresh();
              }}
              data-testid={`scenario-${s.id}`}
            />
            <span>
              <strong>{s.label}</strong>
              <small>{s.description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="lab-timeout">
        Client timeout
        <select
          className="select"
          value={timeoutMs}
          onChange={(e) => {
            const value = Number(e.target.value);
            setTimeoutMs(value);
            if (value === DEFAULT_TIMEOUT_MS) removeKey('pb.api.timeoutMs');
            else localStorage.setItem('pb.api.timeoutMs', String(value));
          }}
        >
          {[2000, 4000, DEFAULT_TIMEOUT_MS, 10000].map((ms) => (
            <option key={ms} value={ms}>
              {ms / 1000} s
            </option>
          ))}
        </select>
      </label>
      <p className="form-status" role="status">
        {notice}
      </p>
      <div className="form-actions">
        <MenuButton
          size="sm"
          variant="secondary"
          onClick={() => {
            resetMockServer();
            removeKey('pb.api.timeoutMs');
            setTimeoutMs(DEFAULT_TIMEOUT_MS);
            client.clear();
            setNotice('Mock server restored: default scenario and initial fixtures.');
          }}
          data-testid="lab-reset"
        >
          Reset
        </MenuButton>
        <MenuButton size="sm" onClick={onClose} data-testid="lab-close">
          Close
        </MenuButton>
      </div>
    </Dialog>
  );
}
