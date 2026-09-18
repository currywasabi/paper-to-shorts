import { useState } from 'react';

import AuthButton from './AuthButton';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { Channel } from '../lib/channels';

export interface ChannelSidebarProps {
  channels: Channel[];
  loading: boolean;
  selectedChannelId: string | null;
  onSelect: (channelId: string | null) => void;
  onCreate: (name: string) => Promise<Channel>;
}

/** "전체" + 사용자가 만든 채널들을 나열하는 사이드바. 채널 만들기는 인라인 입력 폼으로 처리한다. */
function ChannelSidebar({ channels, loading, selectedChannelId, onSelect, onCreate }: ChannelSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError(null);
    try {
      const channel = await onCreate(trimmed);
      setName('');
      setCreating(false);
      onSelect(channel.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '채널을 만들지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">채널</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setCreating((v) => !v)}
            aria-label="채널 만들기"
          >
            +
          </Button>
        </div>

        {creating && (
          <form onSubmit={submitCreate} className="flex flex-col gap-2">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="채널 이름"
              disabled={submitting}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={submitting || !name.trim()}>
                만들기
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setCreating(false);
                  setError(null);
                  setName('');
                }}
              >
                취소
              </Button>
            </div>
          </form>
        )}

        <nav className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
              selectedChannelId === null
                ? 'bg-primary/10 text-primary'
                : 'text-foreground hover:bg-secondary'
            }`}
          >
            전체
          </button>

          {loading && <p className="px-3 py-2 text-sm text-muted-foreground">불러오는 중...</p>}

          {!loading &&
            channels.map((channel) => (
              <button
                key={channel.id}
                type="button"
                onClick={() => onSelect(channel.id)}
                className={`truncate rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                  selectedChannelId === channel.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-secondary'
                }`}
              >
                {channel.name}
              </button>
            ))}

          {!loading && channels.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">아직 만든 채널이 없습니다.</p>
          )}
        </nav>
      </div>

      <div className="flex-none border-t border-border p-3">
        <AuthButton />
      </div>
    </div>
  );
}

export default ChannelSidebar;
