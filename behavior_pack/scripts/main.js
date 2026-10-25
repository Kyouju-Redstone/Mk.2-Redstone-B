import { world, system } from "@minecraft/server";

// ==================== 設定 ====================
const ENTITY_ID = "rsd:power_text";   // 数字エンティティのID
const POWER_PROP = "rsd:power";       // 信号強度を入れるプロパティ
const WIRE_ID = "minecraft:redstone_wire";

const RADIUS_XZ = 6;                  // プレイヤー周囲の探索範囲(横)
const RADIUS_Y = 6;                   // 探索範囲(縦)
const INTERVAL = 5;                   // 更新間隔(tick)
const OFFSET_Y = 0.0625;              // ダスト上面(0.0625)のすぐ上
const ROTATION_Y = 0;                 // 数字の向き(0 / 90 / 180 / 270)

const DIMENSION_IDS = ["overworld", "nether", "the_end"];
const FALLBACK_HEIGHT = { min: -64, max: 320 }; // heightRange が取れない場合の予備

// ==================== 状態 ====================
/** キー("dim|x,y,z") → 数字エンティティ */
const labels = new Map();

// ==================== 起動時の掃除 ====================
function removeAllLabels() {
    for (const dimId of DIMENSION_IDS) {
        try {
            const entities = world.getDimension(dimId).getEntities({ type: ENTITY_ID });
            for (const entity of entities) {
                entity.remove();
            }
        } catch {
            // ディメンションが未ロードの場合は無視
        }
    }
    labels.clear();
}

system.runTimeout(removeAllLabels, 20); // 前回の残骸を掃除

// ==================== ブロック探索 ====================
/** center 周囲のレッドストーンダストごとに callback(x, y, z, block) を呼ぶ */
function forEachWireNear(dim, center, callback) {
    const cx = Math.floor(center.x);
    const cy = Math.floor(center.y);
    const cz = Math.floor(center.z);

    // ワールドの高さ範囲に収める(範囲外の getBlock による例外を避ける)
    const { min, max } = dim.heightRange ?? FALLBACK_HEIGHT;
    const yMin = Math.max(cy - RADIUS_Y, min);
    const yMax = Math.min(cy + RADIUS_Y, max - 1);

    for (let x = cx - RADIUS_XZ; x <= cx + RADIUS_XZ; x++) {
        for (let y = yMin; y <= yMax; y++) {
            for (let z = cz - RADIUS_XZ; z <= cz + RADIUS_XZ; z++) {
                let block;
                try {
                    block = dim.getBlock({ x, y, z }); // 未ロードのチャンクは例外になる
                } catch {
                    continue;
                }

                if (block?.typeId === WIRE_ID) {
                    callback(x, y, z, block);
                }
            }
        }
    }
}

// ==================== ラベルの更新 ====================
/** 1つのダストに対応する数字エンティティを作成・更新する */
function syncLabel(dim, key, x, y, z, power) {
    let entity = labels.get(key);

    if (entity?.isValid) {
        if (entity.getProperty(POWER_PROP) !== power) {
            entity.setProperty(POWER_PROP, power);
        }
        return;
    }

    entity = dim.spawnEntity(ENTITY_ID, { x: x + 0.5, y: y + OFFSET_Y, z: z + 0.5 });
    labels.set(key, entity); // 以降の処理で例外が出ても、管理から漏れないよう先に登録
    entity.setRotation({ x: 0, y: ROTATION_Y });
    entity.setProperty(POWER_PROP, power);
}

/** 今回の探索で対象にならなかったラベル(強度0・範囲外・ダスト消失)を削除する */
function removeStaleLabels(activeKeys) {
    for (const [key, entity] of labels) {
        if (activeKeys.has(key)) {
            continue;
        }

        try {
            if (entity.isValid) {
                entity.remove();
            }
        } catch {
            // 既に消えている場合は無視
        }
        labels.delete(key);
    }
}

// ==================== メイン処理 ====================
function update() {
    const activeKeys = new Set();

    for (const player of world.getAllPlayers()) {
        const dim = player.dimension;

        forEachWireNear(dim, player.location, (x, y, z, block) => {
            const power = block.permutation.getState("redstone_signal");
            if (power <= 0) {
                return; // 強度0は表示しない(下の掃除で削除される)
            }

            const key = `${dim.id}|${x},${y},${z}`;
            if (activeKeys.has(key)) {
                return; // 複数プレイヤーの範囲が重なった場所は1回だけ処理
            }
            activeKeys.add(key);

            try {
                syncLabel(dim, key, x, y, z, power);
            } catch (e) {
                console.warn(`[RedstoneDisplay] ${e}`);
            }
        });
    }

    removeStaleLabels(activeKeys);
}

system.runInterval(update, INTERVAL);
