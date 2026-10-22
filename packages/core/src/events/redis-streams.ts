/**
 * Redis Streams Interface and in-memory engine (PLT-09)
 * Supports high-fidelity consumer groups, PEL (Pending Entries List),
 * XAUTOCLAIM/XPENDING, safe trimming, and observability.
 */

export interface StreamMessage {
  id: string;
  fields: Record<string, string>;
}

export interface PendingEntry {
  id: string;
  consumer: string;
  idleTimeMs: number;
  deliveryCount: number;
}

export interface StreamMetrics {
  streamKey: string;
  length: number;
  lastGeneratedId: string;
  groups: {
    groupName: string;
    pendingCount: number;
    lastDeliveredId: string;
    consumersCount: number;
  }[];
}

export interface IRedisStreams {
  xadd(streamKey: string, fields: Record<string, string>, id?: string): Promise<string>;
  createConsumerGroup(streamKey: string, groupName: string, startId?: string): Promise<void>;
  xreadgroup(
    groupName: string,
    consumerName: string,
    streamKey: string,
    options?: { count?: number; id?: string }
  ): Promise<StreamMessage[]>;
  xack(streamKey: string, groupName: string, ...messageIds: string[]): Promise<number>;
  xpending(
    streamKey: string,
    groupName: string,
    minIdleMs?: number,
    count?: number
  ): Promise<PendingEntry[]>;
  xautoclaim(
    streamKey: string,
    groupName: string,
    consumerName: string,
    minIdleMs: number,
    startId?: string,
    count?: number
  ): Promise<{ nextStartId: string; messages: StreamMessage[] }>;
  xinfo(streamKey: string): Promise<StreamMetrics>;
  xtrimAcknowledged(
    streamKey: string,
    maxAgeMs: number,
    groupNames: string[]
  ): Promise<{ trimmedCount: number; remainingCount: number }>;
  clear(): Promise<void>;
}

interface PelRecord {
  id: string;
  consumer: string;
  firstDeliveredAt: number;
  lastDeliveredAt: number;
  deliveryCount: number;
}

interface InternalConsumerGroup {
  groupName: string;
  lastDeliveredSeq: number; // index in stream entries
  pel: Map<string, PelRecord>; // messageId -> PelRecord
  consumers: Set<string>;
}

/**
 * Robust in-memory implementation of Redis Streams for tests and embedded execution
 */
export class InMemoryRedisStreams implements IRedisStreams {
  private streams: Map<string, StreamMessage[]> = new Map();
  private groups: Map<string, Map<string, InternalConsumerGroup>> = new Map(); // streamKey -> groupName -> group
  private seqCounter = 0;

  async xadd(streamKey: string, fields: Record<string, string>, id: string = "*"): Promise<string> {
    if (!this.streams.has(streamKey)) {
      this.streams.set(streamKey, []);
    }
    const stream = this.streams.get(streamKey)!;
    
    let generatedId = id;
    if (id === "*") {
      const now = Date.now();
      generatedId = `${now}-${this.seqCounter++}`;
    }

    const message: StreamMessage = { id: generatedId, fields: { ...fields } };
    stream.push(message);
    return generatedId;
  }

  async createConsumerGroup(streamKey: string, groupName: string, startId: string = "0"): Promise<void> {
    if (!this.streams.has(streamKey)) {
      this.streams.set(streamKey, []);
    }
    if (!this.groups.has(streamKey)) {
      this.groups.set(streamKey, new Map());
    }
    const streamGroups = this.groups.get(streamKey)!;
    if (!streamGroups.has(groupName)) {
      const stream = this.streams.get(streamKey)!;
      const initialSeq = (startId === "0" || startId === "0-0") ? 0 : stream.length;
      streamGroups.set(groupName, {
        groupName,
        lastDeliveredSeq: initialSeq,
        pel: new Map(),
        consumers: new Set(),
      });
    }
  }

  async xreadgroup(
    groupName: string,
    consumerName: string,
    streamKey: string,
    options?: { count?: number; id?: string }
  ): Promise<StreamMessage[]> {
    const stream = this.streams.get(streamKey) ?? [];
    const streamGroups = this.groups.get(streamKey);
    let group = streamGroups?.get(groupName);

    if (!group) {
      await this.createConsumerGroup(streamKey, groupName, "0");
      group = this.groups.get(streamKey)!.get(groupName)!;
    }

    group.consumers.add(consumerName);
    const count = options?.count ?? 50;
    const readId = options?.id ?? ">";
    const now = Date.now();
    const results: StreamMessage[] = [];

    if (readId === ">") {
      // Read new messages
      let nextIdx = group.lastDeliveredSeq;
      while (nextIdx < stream.length && results.length < count) {
        const msg = stream[nextIdx]!;
        group.pel.set(msg.id, {
          id: msg.id,
          consumer: consumerName,
          firstDeliveredAt: now,
          lastDeliveredAt: now,
          deliveryCount: 1,
        });
        results.push(msg);
        nextIdx++;
      }
      group.lastDeliveredSeq = nextIdx;
    } else {
      // Read existing PEL for this consumer (e.g. id = "0")
      for (const pel of group.pel.values()) {
        if (results.length >= count) break;
        if (pel.consumer === consumerName) {
          const found = stream.find((m) => m.id === pel.id);
          if (found) {
            pel.deliveryCount += 1;
            pel.lastDeliveredAt = now;
            results.push(found);
          }
        }
      }
    }

    return results;
  }

  async xack(streamKey: string, groupName: string, ...messageIds: string[]): Promise<number> {
    const streamGroups = this.groups.get(streamKey);
    const group = streamGroups?.get(groupName);
    if (!group) return 0;

    let acked = 0;
    for (const id of messageIds) {
      if (group.pel.delete(id)) {
        acked++;
      }
    }
    return acked;
  }

  async xpending(
    streamKey: string,
    groupName: string,
    minIdleMs = 0,
    count = 100
  ): Promise<PendingEntry[]> {
    const streamGroups = this.groups.get(streamKey);
    const group = streamGroups?.get(groupName);
    if (!group) return [];

    const now = Date.now();
    const pendingList: PendingEntry[] = [];

    for (const pel of group.pel.values()) {
      const idle = now - pel.lastDeliveredAt;
      if (idle >= minIdleMs) {
        pendingList.push({
          id: pel.id,
          consumer: pel.consumer,
          idleTimeMs: idle,
          deliveryCount: pel.deliveryCount,
        });
        if (pendingList.length >= count) break;
      }
    }

    return pendingList;
  }

  async xautoclaim(
    streamKey: string,
    groupName: string,
    consumerName: string,
    minIdleMs: number,
    _startId = "0-0",
    count = 50
  ): Promise<{ nextStartId: string; messages: StreamMessage[] }> {
    const stream = this.streams.get(streamKey) ?? [];
    const streamGroups = this.groups.get(streamKey);
    const group = streamGroups?.get(groupName);
    if (!group) return { nextStartId: "0-0", messages: [] };

    group.consumers.add(consumerName);
    const now = Date.now();
    const claimedMessages: StreamMessage[] = [];

    for (const pel of group.pel.values()) {
      if (claimedMessages.length >= count) break;
      const idle = now - pel.lastDeliveredAt;
      if (idle >= minIdleMs) {
        pel.consumer = consumerName;
        pel.deliveryCount += 1;
        pel.lastDeliveredAt = now;

        const msg = stream.find((m) => m.id === pel.id);
        if (msg) {
          claimedMessages.push(msg);
        }
      }
    }

    return {
      nextStartId: "0-0",
      messages: claimedMessages,
    };
  }

  async xinfo(streamKey: string): Promise<StreamMetrics> {
    const stream = this.streams.get(streamKey) ?? [];
    const streamGroups = this.groups.get(streamKey) ?? new Map();
    const groups: StreamMetrics["groups"] = [];

    for (const [groupName, group] of streamGroups.entries()) {
      const lastMsg = group.lastDeliveredSeq > 0 ? stream[group.lastDeliveredSeq - 1]?.id ?? "0-0" : "0-0";
      groups.push({
        groupName,
        pendingCount: group.pel.size,
        lastDeliveredId: lastMsg,
        consumersCount: group.consumers.size,
      });
    }

    return {
      streamKey,
      length: stream.length,
      lastGeneratedId: stream.length > 0 ? stream[stream.length - 1]!.id : "0-0",
      groups,
    };
  }

  /**
   * Safely trims stream entries:
   * Non-negotiable constraint:
   * "Trim only stream entries older than 30 days that are acknowledged by all configured consumer groups;
   * never trim pending/unacknowledged entries."
   */
  async xtrimAcknowledged(
    streamKey: string,
    maxAgeMs: number,
    groupNames: string[]
  ): Promise<{ trimmedCount: number; remainingCount: number }> {
    const stream = this.streams.get(streamKey);
    if (!stream || stream.length === 0) {
      return { trimmedCount: 0, remainingCount: 0 };
    }

    const now = Date.now();
    const cutoffTime = now - maxAgeMs;

    // Collect all unacknowledged / pending message IDs across all groups
    const streamGroups = this.groups.get(streamKey) ?? new Map();
    const unackedMessageIds = new Set<string>();

    for (const groupName of groupNames) {
      const group = streamGroups.get(groupName);
      if (group) {
        for (const pelId of group.pel.keys()) {
          unackedMessageIds.add(pelId);
        }
        // Also do not trim messages that have not yet been delivered to this group
        for (let i = group.lastDeliveredSeq; i < stream.length; i++) {
          if (stream[i]) {
            unackedMessageIds.add(stream[i]!.id);
          }
        }
      }
    }

    let trimmedCount = 0;
    const surviving: StreamMessage[] = [];

    for (const msg of stream) {
      // Parse timestamp from message id (e.g. "1729000000000-0")
      const ts = parseInt(msg.id.split("-")[0] ?? "0", 10);
      const isOldEnough = ts > 0 && ts <= cutoffTime;
      const isPending = unackedMessageIds.has(msg.id);

      if (isOldEnough && !isPending) {
        trimmedCount++;
      } else {
        surviving.push(msg);
      }
    }

    this.streams.set(streamKey, surviving);

    // Adjust group sequence pointers
    for (const group of streamGroups.values()) {
      group.lastDeliveredSeq = Math.max(0, group.lastDeliveredSeq - trimmedCount);
    }

    return {
      trimmedCount,
      remainingCount: surviving.length,
    };
  }

  async clear(): Promise<void> {
    this.streams.clear();
    this.groups.clear();
    this.seqCounter = 0;
  }
}
