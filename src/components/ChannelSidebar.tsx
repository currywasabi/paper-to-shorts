import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import AuthButton from './AuthButton';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import type { Channel } from '../lib/channels';

export interface ChannelSidebarProps {
  channels: Channel[];
  loading: boolean;
  selectedChannelId: string | null;
  onSelect: (channelId: string | null) => void;
  onCreate: (name: string) => Promise<Channel>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

interface ChannelItemProps {
  channel: Channel;
  selected: boolean;
  onSelect: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

/** 채널 한 줄 — 평소엔 선택 버튼, 편집 모드에선 인라인 입력, 삭제는 확인 모달을 거친다. */
function ChannelItem({ channel, selected, onSelect, onRename, onDelete }: ChannelItemProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(channel.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function submitRename(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === channel.name) {
      setEditing(false);
      setName(channel.name);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onRename(trimmed);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '이름을 바꾸지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await onDelete();
      setDeleteOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '채널을 삭제하지 못했습니다.');
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={submitRename} className="flex flex-col gap-1 px-1">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={saving}
          onBlur={submitRename}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </form>
    );
  }

  return (
    <div
      className={`group flex items-center rounded-lg backdrop-blur-sm transition-colors ${
        selected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-secondary/70'
      }`}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm font-medium">
        {channel.name}
      </button>
      <div className="flex flex-none items-center gap-0.5 pr-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="채널 이름 변경"
          onClick={() => {
            setName(channel.name);
            setEditing(true);
          }}
        >
          <Pencil />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="채널 삭제"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 />
        </Button>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>채널 삭제</DialogTitle>
            <DialogDescription>
              "{channel.name}" 채널과 그 안의 모든 영상이 함께 삭제됩니다. 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              취소
            </Button>
            <Button type="button" variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? '삭제 중...' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "전체" + 사용자가 만든 채널들을 나열하는 사이드바. 채널 만들기는 인라인 입력 폼으로 처리한다. */
function ChannelSidebar({
  channels,
  loading,
  selectedChannelId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: ChannelSidebarProps) {
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
                : 'text-foreground hover:bg-secondary/70'
            }`}
          >
            전체
          </button>

          <div className="my-1 border-t border-border" />

          {loading && <p className="px-3 py-2 text-sm text-muted-foreground">불러오는 중...</p>}

          {!loading &&
            channels.map((channel) => (
              <ChannelItem
                key={channel.id}
                channel={channel}
                selected={selectedChannelId === channel.id}
                onSelect={() => onSelect(channel.id)}
                onRename={(name) => onRename(channel.id, name)}
                onDelete={async () => {
                  await onDelete(channel.id);
                  if (selectedChannelId === channel.id) onSelect(null);
                }}
              />
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
