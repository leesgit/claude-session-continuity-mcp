#!/usr/bin/env node
import * as http from 'http';
import * as url from 'url';
import Database from 'better-sqlite3';
import * as path from 'path';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/Users/ibyeongchang/Documents/dev/ai-service-generator';
const DB_PATH = path.join(WORKSPACE_ROOT, '.claude', 'sessions.db');
const PORT = parseInt(process.env.PORT || '8000');
const db = new Database(DB_PATH);
// ===== 다국어 지원 =====
const i18n = {
    en: {
        title: 'Project Manager MCP Dashboard',
        memories: 'Memories',
        sessions: 'Sessions',
        relations: 'Relations',
        embeddings: 'Embeddings',
        totalMemories: 'Total Memories',
        totalSessions: 'Sessions',
        totalRelations: 'Relations',
        totalPatterns: 'Patterns',
        search: 'Search memories...',
        allTypes: 'All Types',
        allProjects: 'All Projects',
        id: 'ID',
        type: 'Type',
        content: 'Content',
        tags: 'Tags',
        project: 'Project',
        importance: 'Importance',
        created: 'Created',
        actions: 'Actions',
        view: 'View',
        edit: 'Edit',
        delete: 'Delete',
        close: 'Close',
        cancel: 'Cancel',
        update: 'Update Memory',
        noMemories: 'No memories found',
        noSessions: 'No sessions found',
        noRelations: 'No relations found',
        confirmDelete: 'Are you sure you want to delete this memory?',
        updated: 'Memory updated successfully!',
        deleted: 'Memory deleted',
        lastWork: 'Last Work',
        status: 'Status',
        verification: 'Verification',
        timestamp: 'Timestamp',
        source: 'Source',
        relation: 'Relation',
        target: 'Target',
        strength: 'Strength',
        modelStatus: 'Model Status',
        model: 'Model',
        dimensions: 'Dimensions',
        coverage: 'Coverage',
        ready: 'Ready',
        loading: 'Loading',
        language: 'Language',
        observation: 'observation',
        decision: 'decision',
        learning: 'learning',
        error: 'error',
        pattern: 'pattern',
        preference: 'preference'
    },
    ko: {
        title: 'Project Manager MCP 대시보드',
        memories: '메모리',
        sessions: '세션',
        relations: '관계',
        embeddings: '임베딩',
        totalMemories: '총 메모리',
        totalSessions: '세션',
        totalRelations: '관계',
        totalPatterns: '패턴',
        search: '메모리 검색...',
        allTypes: '전체 유형',
        allProjects: '전체 프로젝트',
        id: 'ID',
        type: '유형',
        content: '내용',
        tags: '태그',
        project: '프로젝트',
        importance: '중요도',
        created: '생성일',
        actions: '작업',
        view: '보기',
        edit: '수정',
        delete: '삭제',
        close: '닫기',
        cancel: '취소',
        update: '메모리 업데이트',
        noMemories: '메모리가 없습니다',
        noSessions: '세션이 없습니다',
        noRelations: '관계가 없습니다',
        confirmDelete: '이 메모리를 삭제하시겠습니까?',
        updated: '메모리가 업데이트되었습니다!',
        deleted: '메모리가 삭제되었습니다',
        lastWork: '마지막 작업',
        status: '상태',
        verification: '검증',
        timestamp: '시간',
        source: '출발',
        relation: '관계',
        target: '도착',
        strength: '강도',
        modelStatus: '모델 상태',
        model: '모델',
        dimensions: '차원',
        coverage: '커버리지',
        ready: '준비됨',
        loading: '로딩 중',
        language: '언어',
        observation: '관찰',
        decision: '결정',
        learning: '학습',
        error: '에러',
        pattern: '패턴',
        preference: '선호'
    },
    ja: {
        title: 'Project Manager MCP ダッシュボード',
        memories: 'メモリ',
        sessions: 'セッション',
        relations: '関係',
        embeddings: '埋め込み',
        totalMemories: '総メモリ',
        totalSessions: 'セッション',
        totalRelations: '関係',
        totalPatterns: 'パターン',
        search: 'メモリを検索...',
        allTypes: 'すべてのタイプ',
        allProjects: 'すべてのプロジェクト',
        id: 'ID',
        type: 'タイプ',
        content: '内容',
        tags: 'タグ',
        project: 'プロジェクト',
        importance: '重要度',
        created: '作成日',
        actions: 'アクション',
        view: '表示',
        edit: '編集',
        delete: '削除',
        close: '閉じる',
        cancel: 'キャンセル',
        update: 'メモリを更新',
        noMemories: 'メモリが見つかりません',
        noSessions: 'セッションが見つかりません',
        noRelations: '関係が見つかりません',
        confirmDelete: 'このメモリを削除しますか？',
        updated: 'メモリが更新されました！',
        deleted: 'メモリが削除されました',
        lastWork: '最後の作業',
        status: 'ステータス',
        verification: '検証',
        timestamp: 'タイムスタンプ',
        source: 'ソース',
        relation: '関係',
        target: 'ターゲット',
        strength: '強度',
        modelStatus: 'モデル状態',
        model: 'モデル',
        dimensions: '次元',
        coverage: 'カバレッジ',
        ready: '準備完了',
        loading: '読み込み中',
        language: '言語',
        observation: '観察',
        decision: '決定',
        learning: '学習',
        error: 'エラー',
        pattern: 'パターン',
        preference: '好み'
    },
    zh: {
        title: 'Project Manager MCP 仪表板',
        memories: '记忆',
        sessions: '会话',
        relations: '关系',
        embeddings: '嵌入',
        totalMemories: '总记忆',
        totalSessions: '会话',
        totalRelations: '关系',
        totalPatterns: '模式',
        search: '搜索记忆...',
        allTypes: '所有类型',
        allProjects: '所有项目',
        id: 'ID',
        type: '类型',
        content: '内容',
        tags: '标签',
        project: '项目',
        importance: '重要性',
        created: '创建时间',
        actions: '操作',
        view: '查看',
        edit: '编辑',
        delete: '删除',
        close: '关闭',
        cancel: '取消',
        update: '更新记忆',
        noMemories: '没有找到记忆',
        noSessions: '没有找到会话',
        noRelations: '没有找到关系',
        confirmDelete: '确定要删除这条记忆吗？',
        updated: '记忆更新成功！',
        deleted: '记忆已删除',
        lastWork: '最后工作',
        status: '状态',
        verification: '验证',
        timestamp: '时间戳',
        source: '来源',
        relation: '关系',
        target: '目标',
        strength: '强度',
        modelStatus: '模型状态',
        model: '模型',
        dimensions: '维度',
        coverage: '覆盖率',
        ready: '就绪',
        loading: '加载中',
        language: '语言',
        observation: '观察',
        decision: '决定',
        learning: '学习',
        error: '错误',
        pattern: '模式',
        preference: '偏好'
    },
    de: {
        title: 'Project Manager MCP Dashboard',
        memories: 'Erinnerungen',
        sessions: 'Sitzungen',
        relations: 'Beziehungen',
        embeddings: 'Einbettungen',
        totalMemories: 'Gesamt',
        totalSessions: 'Sitzungen',
        totalRelations: 'Beziehungen',
        totalPatterns: 'Muster',
        search: 'Erinnerungen suchen...',
        allTypes: 'Alle Typen',
        allProjects: 'Alle Projekte',
        id: 'ID',
        type: 'Typ',
        content: 'Inhalt',
        tags: 'Tags',
        project: 'Projekt',
        importance: 'Wichtigkeit',
        created: 'Erstellt',
        actions: 'Aktionen',
        view: 'Ansehen',
        edit: 'Bearbeiten',
        delete: 'Löschen',
        close: 'Schließen',
        cancel: 'Abbrechen',
        update: 'Aktualisieren',
        noMemories: 'Keine Erinnerungen gefunden',
        noSessions: 'Keine Sitzungen gefunden',
        noRelations: 'Keine Beziehungen gefunden',
        confirmDelete: 'Möchten Sie diese Erinnerung wirklich löschen?',
        updated: 'Erinnerung erfolgreich aktualisiert!',
        deleted: 'Erinnerung gelöscht',
        lastWork: 'Letzte Arbeit',
        status: 'Status',
        verification: 'Verifizierung',
        timestamp: 'Zeitstempel',
        source: 'Quelle',
        relation: 'Beziehung',
        target: 'Ziel',
        strength: 'Stärke',
        modelStatus: 'Modellstatus',
        model: 'Modell',
        dimensions: 'Dimensionen',
        coverage: 'Abdeckung',
        ready: 'Bereit',
        loading: 'Laden',
        language: 'Sprache',
        observation: 'Beobachtung',
        decision: 'Entscheidung',
        learning: 'Lernen',
        error: 'Fehler',
        pattern: 'Muster',
        preference: 'Präferenz'
    },
    fr: {
        title: 'Tableau de bord Project Manager MCP',
        memories: 'Mémoires',
        sessions: 'Sessions',
        relations: 'Relations',
        embeddings: 'Incorporations',
        totalMemories: 'Total',
        totalSessions: 'Sessions',
        totalRelations: 'Relations',
        totalPatterns: 'Modèles',
        search: 'Rechercher...',
        allTypes: 'Tous les types',
        allProjects: 'Tous les projets',
        id: 'ID',
        type: 'Type',
        content: 'Contenu',
        tags: 'Tags',
        project: 'Projet',
        importance: 'Importance',
        created: 'Créé',
        actions: 'Actions',
        view: 'Voir',
        edit: 'Modifier',
        delete: 'Supprimer',
        close: 'Fermer',
        cancel: 'Annuler',
        update: 'Mettre à jour',
        noMemories: 'Aucune mémoire trouvée',
        noSessions: 'Aucune session trouvée',
        noRelations: 'Aucune relation trouvée',
        confirmDelete: 'Voulez-vous vraiment supprimer cette mémoire?',
        updated: 'Mémoire mise à jour avec succès!',
        deleted: 'Mémoire supprimée',
        lastWork: 'Dernier travail',
        status: 'Statut',
        verification: 'Vérification',
        timestamp: 'Horodatage',
        source: 'Source',
        relation: 'Relation',
        target: 'Cible',
        strength: 'Force',
        modelStatus: 'État du modèle',
        model: 'Modèle',
        dimensions: 'Dimensions',
        coverage: 'Couverture',
        ready: 'Prêt',
        loading: 'Chargement',
        language: 'Langue',
        observation: 'observation',
        decision: 'décision',
        learning: 'apprentissage',
        error: 'erreur',
        pattern: 'modèle',
        preference: 'préférence'
    },
    es: {
        title: 'Panel de Project Manager MCP',
        memories: 'Memorias',
        sessions: 'Sesiones',
        relations: 'Relaciones',
        embeddings: 'Incrustaciones',
        totalMemories: 'Total',
        totalSessions: 'Sesiones',
        totalRelations: 'Relaciones',
        totalPatterns: 'Patrones',
        search: 'Buscar memorias...',
        allTypes: 'Todos los tipos',
        allProjects: 'Todos los proyectos',
        id: 'ID',
        type: 'Tipo',
        content: 'Contenido',
        tags: 'Etiquetas',
        project: 'Proyecto',
        importance: 'Importancia',
        created: 'Creado',
        actions: 'Acciones',
        view: 'Ver',
        edit: 'Editar',
        delete: 'Eliminar',
        close: 'Cerrar',
        cancel: 'Cancelar',
        update: 'Actualizar',
        noMemories: 'No se encontraron memorias',
        noSessions: 'No se encontraron sesiones',
        noRelations: 'No se encontraron relaciones',
        confirmDelete: '¿Está seguro de que desea eliminar esta memoria?',
        updated: '¡Memoria actualizada con éxito!',
        deleted: 'Memoria eliminada',
        lastWork: 'Último trabajo',
        status: 'Estado',
        verification: 'Verificación',
        timestamp: 'Marca de tiempo',
        source: 'Origen',
        relation: 'Relación',
        target: 'Destino',
        strength: 'Fuerza',
        modelStatus: 'Estado del modelo',
        model: 'Modelo',
        dimensions: 'Dimensiones',
        coverage: 'Cobertura',
        ready: 'Listo',
        loading: 'Cargando',
        language: 'Idioma',
        observation: 'observación',
        decision: 'decisión',
        learning: 'aprendizaje',
        error: 'error',
        pattern: 'patrón',
        preference: 'preferencia'
    }
};
// ===== API 핸들러 =====
function getMemories(params) {
    const type = params.get('type');
    const project = params.get('project');
    const search = params.get('search');
    const limit = parseInt(params.get('limit') || '50');
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const sqlParams = [];
    if (type) {
        sql += ' AND memory_type = ?';
        sqlParams.push(type);
    }
    if (project) {
        sql += ' AND project = ?';
        sqlParams.push(project);
    }
    if (search) {
        sql += ' AND (content LIKE ? OR tags LIKE ?)';
        sqlParams.push(`%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    sqlParams.push(limit);
    const stmt = db.prepare(sql);
    return stmt.all(...sqlParams);
}
function getMemory(id) {
    const stmt = db.prepare('SELECT * FROM memories WHERE id = ?');
    return stmt.get(id);
}
function updateMemory(id, data) {
    const updates = [];
    const params = [];
    if (data.content !== undefined) {
        updates.push('content = ?');
        params.push(data.content);
    }
    if (data.tags !== undefined) {
        updates.push('tags = ?');
        params.push(JSON.stringify(data.tags));
    }
    if (data.importance !== undefined) {
        updates.push('importance = ?');
        params.push(data.importance);
    }
    if (data.memory_type !== undefined) {
        updates.push('memory_type = ?');
        params.push(data.memory_type);
    }
    if (updates.length === 0)
        return { success: false, message: 'No updates' };
    params.push(id);
    const sql = `UPDATE memories SET ${updates.join(', ')} WHERE id = ?`;
    const stmt = db.prepare(sql);
    const result = stmt.run(...params);
    return { success: result.changes > 0 };
}
function deleteMemoryById(id) {
    const stmt = db.prepare('DELETE FROM memories WHERE id = ?');
    const result = stmt.run(id);
    return { success: result.changes > 0 };
}
function getSessions(params) {
    const project = params.get('project');
    const limit = parseInt(params.get('limit') || '50');
    let sql = 'SELECT * FROM sessions WHERE 1=1';
    const sqlParams = [];
    if (project) {
        sql += ' AND project = ?';
        sqlParams.push(project);
    }
    sql += ' ORDER BY timestamp DESC LIMIT ?';
    sqlParams.push(limit);
    const stmt = db.prepare(sql);
    return stmt.all(...sqlParams);
}
function getStats() {
    const memoriesCount = db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
    const sessionsCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
    const relationsCount = db.prepare('SELECT COUNT(*) as count FROM memory_relations').get().count;
    const patternsCount = db.prepare('SELECT COUNT(*) as count FROM work_patterns').get().count;
    // 임베딩 통계
    let embeddingsCount = 0;
    try {
        embeddingsCount = db.prepare('SELECT COUNT(*) as count FROM embeddings').get().count;
    }
    catch {
        // embeddings 테이블이 없을 수 있음
    }
    const memoryTypes = db.prepare('SELECT memory_type, COUNT(*) as count FROM memories GROUP BY memory_type').all();
    const projects = db.prepare('SELECT DISTINCT project FROM memories WHERE project IS NOT NULL UNION SELECT DISTINCT project FROM sessions').all();
    return {
        memories: memoriesCount,
        sessions: sessionsCount,
        relations: relationsCount,
        patterns: patternsCount,
        embeddings: embeddingsCount,
        embeddingCoverage: memoriesCount > 0 ? Math.round((embeddingsCount / memoriesCount) * 100) : 100,
        memoryTypes,
        projects
    };
}
function getRelations(memoryId) {
    if (memoryId) {
        const stmt = db.prepare(`
      SELECT r.*,
        s.content as source_content, s.memory_type as source_type,
        t.content as target_content, t.memory_type as target_type
      FROM memory_relations r
      JOIN memories s ON r.source_id = s.id
      JOIN memories t ON r.target_id = t.id
      WHERE r.source_id = ? OR r.target_id = ?
    `);
        return stmt.all(memoryId, memoryId);
    }
    const stmt = db.prepare(`
    SELECT r.*,
      s.content as source_content, s.memory_type as source_type,
      t.content as target_content, t.memory_type as target_type
    FROM memory_relations r
    JOIN memories s ON r.source_id = s.id
    JOIN memories t ON r.target_id = t.id
    LIMIT 100
  `);
    return stmt.all();
}
// ===== HTML 템플릿 =====
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Project Manager MCP Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a; color: #e2e8f0; line-height: 1.6;
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }

    header {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      padding: 24px; border-radius: 12px; margin-bottom: 24px;
      display: flex; justify-content: space-between; align-items: center;
    }
    header h1 { font-size: 1.5rem; display: flex; align-items: center; gap: 12px; }
    header h1::before { content: '🧠'; font-size: 1.8rem; }

    .header-right { display: flex; align-items: center; gap: 16px; }
    .lang-select {
      padding: 8px 12px; background: #0f172a; border: 1px solid #334155;
      border-radius: 8px; color: #e2e8f0; font-size: 0.875rem; cursor: pointer;
    }

    .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-bottom: 24px; }
    .stat-card {
      background: #1e293b; padding: 20px; border-radius: 12px;
      border: 1px solid #334155; transition: transform 0.2s;
    }
    .stat-card:hover { transform: translateY(-2px); }
    .stat-card h3 { color: #94a3b8; font-size: 0.875rem; margin-bottom: 8px; }
    .stat-card .value { font-size: 2rem; font-weight: bold; color: #38bdf8; }
    .stat-card .sub { font-size: 0.75rem; color: #64748b; margin-top: 4px; }

    .tabs { display: flex; gap: 8px; margin-bottom: 20px; }
    .tab {
      padding: 12px 24px; background: #1e293b; border: none; color: #94a3b8;
      border-radius: 8px; cursor: pointer; font-size: 0.875rem; transition: all 0.2s;
    }
    .tab:hover { background: #334155; }
    .tab.active { background: #3b82f6; color: white; }

    .filters {
      display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap;
      background: #1e293b; padding: 16px; border-radius: 12px;
    }
    .filters input, .filters select {
      padding: 10px 16px; background: #0f172a; border: 1px solid #334155;
      border-radius: 8px; color: #e2e8f0; font-size: 0.875rem;
    }
    .filters input:focus, .filters select:focus {
      outline: none; border-color: #3b82f6;
    }
    .filters input { flex: 1; min-width: 200px; }

    .content { background: #1e293b; border-radius: 12px; overflow: hidden; }

    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 14px 16px; text-align: left; border-bottom: 1px solid #334155; }
    th { background: #0f172a; color: #94a3b8; font-weight: 500; font-size: 0.75rem; text-transform: uppercase; }
    tr:hover { background: #334155; }

    .tag {
      display: inline-block; padding: 4px 10px; background: #3b82f6;
      border-radius: 12px; font-size: 0.75rem; margin: 2px;
    }
    .tag.learning { background: #8b5cf6; }
    .tag.decision { background: #f59e0b; }
    .tag.error { background: #ef4444; }
    .tag.pattern { background: #10b981; }
    .tag.observation { background: #6366f1; }
    .tag.preference { background: #ec4899; }

    .importance {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 8px; background: #334155; border-radius: 6px; font-size: 0.75rem;
    }
    .importance.high { background: #ef4444; }
    .importance.medium { background: #f59e0b; }
    .importance.low { background: #6b7280; }

    .actions { display: flex; gap: 8px; }
    .btn {
      padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer;
      font-size: 0.75rem; transition: all 0.2s;
    }
    .btn-edit { background: #3b82f6; color: white; }
    .btn-edit:hover { background: #2563eb; }
    .btn-delete { background: #ef4444; color: white; }
    .btn-delete:hover { background: #dc2626; }
    .btn-view { background: #334155; color: #e2e8f0; }
    .btn-view:hover { background: #475569; }

    .modal {
      display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.8); justify-content: center; align-items: center; z-index: 1000;
    }
    .modal.active { display: flex; }
    .modal-content {
      background: #1e293b; padding: 32px; border-radius: 16px;
      width: 90%; max-width: 600px; max-height: 80vh; overflow-y: auto;
    }
    .modal-content h2 { margin-bottom: 24px; display: flex; align-items: center; gap: 12px; }
    .modal-content label { display: block; margin-bottom: 8px; color: #94a3b8; font-size: 0.875rem; }
    .modal-content input, .modal-content textarea, .modal-content select {
      width: 100%; padding: 12px; background: #0f172a; border: 1px solid #334155;
      border-radius: 8px; color: #e2e8f0; margin-bottom: 16px; font-size: 0.875rem;
    }
    .modal-content textarea { min-height: 120px; resize: vertical; font-family: inherit; }
    .modal-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; }
    .btn-primary { background: #3b82f6; color: white; padding: 12px 24px; }
    .btn-secondary { background: #334155; color: #e2e8f0; padding: 12px 24px; }

    .truncate { max-width: 400px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .empty { text-align: center; padding: 60px; color: #64748b; }
    .empty::before { content: '📭'; font-size: 3rem; display: block; margin-bottom: 16px; }

    .toast {
      position: fixed; bottom: 20px; right: 20px; padding: 16px 24px;
      background: #10b981; color: white; border-radius: 8px;
      transform: translateY(100px); opacity: 0; transition: all 0.3s;
    }
    .toast.show { transform: translateY(0); opacity: 1; }
    .toast.error { background: #ef4444; }

    .embedding-bar {
      height: 8px; background: #334155; border-radius: 4px; overflow: hidden; margin-top: 8px;
    }
    .embedding-bar .fill {
      height: 100%; background: linear-gradient(90deg, #3b82f6, #10b981);
      transition: width 0.3s;
    }

    @media (max-width: 768px) {
      .stats { grid-template-columns: repeat(2, 1fr); }
      .header-right { flex-direction: column; gap: 8px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1 id="page-title">Project Manager MCP Dashboard</h1>
      <div class="header-right">
        <select class="lang-select" id="lang-select" onchange="changeLanguage(this.value)">
          <option value="en">English</option>
          <option value="ko">한국어</option>
          <option value="ja">日本語</option>
          <option value="zh">中文</option>
          <option value="de">Deutsch</option>
          <option value="fr">Français</option>
          <option value="es">Español</option>
        </select>
      </div>
    </header>

    <div class="stats" id="stats"></div>

    <div class="tabs" id="tabs"></div>

    <div class="filters" id="filters"></div>

    <div class="content" id="content"></div>
  </div>

  <div class="modal" id="modal">
    <div class="modal-content" id="modal-content"></div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    // 다국어 데이터
    const i18n = ${JSON.stringify(i18n)};

    let currentLang = localStorage.getItem('mcp-lang') || 'en';
    let currentTab = 'memories';
    let stats = {};

    function t(key) {
      return i18n[currentLang]?.[key] || i18n['en'][key] || key;
    }

    function changeLanguage(lang) {
      currentLang = lang;
      localStorage.setItem('mcp-lang', lang);
      document.getElementById('lang-select').value = lang;
      updateUI();
    }

    function updateUI() {
      document.getElementById('page-title').textContent = t('title');
      document.title = t('title');
      renderTabs();
      loadStats();
    }

    function renderTabs() {
      document.getElementById('tabs').innerHTML = \`
        <button class="tab \${currentTab === 'memories' ? 'active' : ''}" data-tab="memories">🧠 \${t('memories')}</button>
        <button class="tab \${currentTab === 'sessions' ? 'active' : ''}" data-tab="sessions">📝 \${t('sessions')}</button>
        <button class="tab \${currentTab === 'relations' ? 'active' : ''}" data-tab="relations">🔗 \${t('relations')}</button>
        <button class="tab \${currentTab === 'embeddings' ? 'active' : ''}" data-tab="embeddings">🔮 \${t('embeddings')}</button>
      \`;
      document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          currentTab = tab.dataset.tab;
          renderFilters();
          loadContent();
        });
      });
    }

    // API 호출
    async function api(endpoint, options = {}) {
      const res = await fetch('/api' + endpoint, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers }
      });
      return res.json();
    }

    // 토스트 메시지
    function showToast(message, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast show' + (isError ? ' error' : '');
      setTimeout(() => toast.className = 'toast', 3000);
    }

    // 통계 로드
    async function loadStats() {
      stats = await api('/stats');
      document.getElementById('stats').innerHTML = \`
        <div class="stat-card">
          <h3>\${t('totalMemories')}</h3>
          <div class="value">\${stats.memories}</div>
        </div>
        <div class="stat-card">
          <h3>\${t('totalSessions')}</h3>
          <div class="value">\${stats.sessions}</div>
        </div>
        <div class="stat-card">
          <h3>\${t('totalRelations')}</h3>
          <div class="value">\${stats.relations}</div>
        </div>
        <div class="stat-card">
          <h3>\${t('totalPatterns')}</h3>
          <div class="value">\${stats.patterns}</div>
        </div>
        <div class="stat-card">
          <h3>\${t('embeddings')}</h3>
          <div class="value">\${stats.embeddings || 0}</div>
          <div class="sub">\${t('coverage')}: \${stats.embeddingCoverage || 0}%</div>
          <div class="embedding-bar"><div class="fill" style="width: \${stats.embeddingCoverage || 0}%"></div></div>
        </div>
      \`;
      renderFilters();
      loadContent();
    }

    // 필터 렌더링
    function renderFilters() {
      const projects = stats.projects?.map(p => p.project).filter(Boolean) || [];
      const types = ['observation', 'decision', 'learning', 'error', 'pattern', 'preference'];

      if (currentTab === 'memories') {
        document.getElementById('filters').innerHTML = \`
          <input type="text" id="search" placeholder="\${t('search')}" onkeyup="debounce(loadContent, 300)()">
          <select id="type-filter" onchange="loadContent()">
            <option value="">\${t('allTypes')}</option>
            \${types.map(tp => \`<option value="\${tp}">\${t(tp)}</option>\`).join('')}
          </select>
          <select id="project-filter" onchange="loadContent()">
            <option value="">\${t('allProjects')}</option>
            \${projects.map(p => \`<option value="\${p}">\${p}</option>\`).join('')}
          </select>
        \`;
      } else if (currentTab === 'sessions') {
        document.getElementById('filters').innerHTML = \`
          <select id="project-filter" onchange="loadContent()">
            <option value="">\${t('allProjects')}</option>
            \${projects.map(p => \`<option value="\${p}">\${p}</option>\`).join('')}
          </select>
        \`;
      } else {
        document.getElementById('filters').innerHTML = '';
      }
    }

    // 디바운스
    function debounce(fn, delay) {
      let timeout;
      return function() {
        clearTimeout(timeout);
        timeout = setTimeout(fn, delay);
      };
    }

    // 컨텐츠 로드
    async function loadContent() {
      const content = document.getElementById('content');

      if (currentTab === 'memories') {
        const search = document.getElementById('search')?.value || '';
        const type = document.getElementById('type-filter')?.value || '';
        const project = document.getElementById('project-filter')?.value || '';

        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (type) params.set('type', type);
        if (project) params.set('project', project);

        const memories = await api('/memories?' + params);

        if (memories.length === 0) {
          content.innerHTML = '<div class="empty">' + t('noMemories') + '</div>';
          return;
        }

        content.innerHTML = \`
          <table>
            <thead>
              <tr>
                <th>\${t('id')}</th>
                <th>\${t('type')}</th>
                <th>\${t('content')}</th>
                <th>\${t('tags')}</th>
                <th>\${t('project')}</th>
                <th>\${t('importance')}</th>
                <th>\${t('created')}</th>
                <th>\${t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              \${memories.map(m => \`
                <tr>
                  <td>\${m.id}</td>
                  <td><span class="tag \${m.memory_type}">\${t(m.memory_type)}</span></td>
                  <td class="truncate" title="\${m.content.replace(/"/g, '&quot;')}">\${m.content}</td>
                  <td>\${(JSON.parse(m.tags || '[]')).map(tg => \`<span class="tag">\${tg}</span>\`).join('')}</td>
                  <td>\${m.project || '-'}</td>
                  <td>
                    <span class="importance \${m.importance >= 8 ? 'high' : m.importance >= 5 ? 'medium' : 'low'}">
                      ⭐ \${m.importance}
                    </span>
                  </td>
                  <td>\${new Date(m.created_at).toLocaleDateString(currentLang)}</td>
                  <td class="actions">
                    <button class="btn btn-view" onclick="viewMemory(\${m.id})">\${t('view')}</button>
                    <button class="btn btn-edit" onclick="editMemory(\${m.id})">\${t('edit')}</button>
                    <button class="btn btn-delete" onclick="deleteMemory(\${m.id})">\${t('delete')}</button>
                  </td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        \`;
      } else if (currentTab === 'sessions') {
        const project = document.getElementById('project-filter')?.value || '';
        const params = new URLSearchParams();
        if (project) params.set('project', project);

        const sessions = await api('/sessions?' + params);

        if (sessions.length === 0) {
          content.innerHTML = '<div class="empty">' + t('noSessions') + '</div>';
          return;
        }

        content.innerHTML = \`
          <table>
            <thead>
              <tr>
                <th>\${t('id')}</th>
                <th>\${t('project')}</th>
                <th>\${t('lastWork')}</th>
                <th>\${t('status')}</th>
                <th>\${t('verification')}</th>
                <th>\${t('timestamp')}</th>
              </tr>
            </thead>
            <tbody>
              \${sessions.map(s => \`
                <tr>
                  <td>\${s.id}</td>
                  <td>\${s.project}</td>
                  <td class="truncate">\${s.last_work}</td>
                  <td>\${s.current_status || '-'}</td>
                  <td>
                    <span class="tag \${s.verification_result === 'passed' ? 'pattern' : s.verification_result === 'failed' ? 'error' : ''}">\${s.verification_result || '-'}</span>
                  </td>
                  <td>\${new Date(s.timestamp).toLocaleString(currentLang)}</td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        \`;
      } else if (currentTab === 'relations') {
        const relations = await api('/relations');

        if (relations.length === 0) {
          content.innerHTML = '<div class="empty">' + t('noRelations') + '</div>';
          return;
        }

        content.innerHTML = \`
          <table>
            <thead>
              <tr>
                <th>\${t('source')}</th>
                <th>\${t('relation')}</th>
                <th>\${t('target')}</th>
                <th>\${t('strength')}</th>
              </tr>
            </thead>
            <tbody>
              \${relations.map(r => \`
                <tr>
                  <td>
                    <span class="tag \${r.source_type}">\${t(r.source_type)}</span>
                    <span class="truncate" style="display: block; max-width: 300px;">\${r.source_content}</span>
                  </td>
                  <td><strong>\${r.relation_type}</strong></td>
                  <td>
                    <span class="tag \${r.target_type}">\${t(r.target_type)}</span>
                    <span class="truncate" style="display: block; max-width: 300px;">\${r.target_content}</span>
                  </td>
                  <td>\${r.strength}</td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        \`;
      } else if (currentTab === 'embeddings') {
        content.innerHTML = \`
          <div style="padding: 40px; text-align: center;">
            <h2 style="margin-bottom: 24px;">🔮 \${t('embeddings')} \${t('status')}</h2>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 600px; margin: 0 auto;">
              <div class="stat-card">
                <h3>\${t('modelStatus')}</h3>
                <div class="value" style="font-size: 1.2rem; color: #10b981;">all-MiniLM-L6-v2</div>
              </div>
              <div class="stat-card">
                <h3>\${t('dimensions')}</h3>
                <div class="value">384</div>
              </div>
              <div class="stat-card">
                <h3>\${t('coverage')}</h3>
                <div class="value">\${stats.embeddingCoverage || 0}%</div>
              </div>
            </div>
            <div style="margin-top: 32px; color: #94a3b8;">
              <p>\${stats.embeddings || 0} / \${stats.memories} memories embedded</p>
              <div class="embedding-bar" style="max-width: 400px; margin: 16px auto; height: 12px;">
                <div class="fill" style="width: \${stats.embeddingCoverage || 0}%"></div>
              </div>
            </div>
          </div>
        \`;
      }
    }

    // 메모리 보기
    async function viewMemory(id) {
      const m = await api('/memories/' + id);
      const tags = JSON.parse(m.tags || '[]');

      document.getElementById('modal-content').innerHTML = \`
        <h2>🧠 Memory #\${m.id}</h2>
        <div style="margin-bottom: 16px;">
          <span class="tag \${m.memory_type}">\${t(m.memory_type)}</span>
          <span class="importance \${m.importance >= 8 ? 'high' : m.importance >= 5 ? 'medium' : 'low'}">⭐ \${m.importance}</span>
        </div>
        <label>\${t('content')}</label>
        <div style="background: #0f172a; padding: 16px; border-radius: 8px; margin-bottom: 16px; white-space: pre-wrap;">\${m.content}</div>
        <label>\${t('tags')}</label>
        <div style="margin-bottom: 16px;">\${tags.map(tg => \`<span class="tag">\${tg}</span>\`).join(' ') || 'No tags'}</div>
        <label>\${t('project')}</label>
        <div style="margin-bottom: 16px;">\${m.project || 'None'}</div>
        <label>\${t('created')}</label>
        <div style="margin-bottom: 16px;">\${new Date(m.created_at).toLocaleString(currentLang)}</div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="closeModal()">\${t('close')}</button>
          <button class="btn btn-primary" onclick="editMemory(\${m.id})">\${t('edit')}</button>
        </div>
      \`;
      document.getElementById('modal').classList.add('active');
    }

    // 메모리 편집
    async function editMemory(id) {
      const m = await api('/memories/' + id);
      const tags = JSON.parse(m.tags || '[]');
      const types = ['observation', 'decision', 'learning', 'error', 'pattern', 'preference'];

      document.getElementById('modal-content').innerHTML = \`
        <h2>✏️ \${t('edit')} Memory #\${m.id}</h2>
        <label>\${t('content')}</label>
        <textarea id="edit-content">\${m.content}</textarea>
        <label>\${t('type')}</label>
        <select id="edit-type">
          \${types.map(tp => \`<option value="\${tp}" \${tp === m.memory_type ? 'selected' : ''}>\${t(tp)}</option>\`).join('')}
        </select>
        <label>\${t('tags')} (comma-separated)</label>
        <input type="text" id="edit-tags" value="\${tags.join(', ')}">
        <label>\${t('importance')} (1-10)</label>
        <input type="number" id="edit-importance" value="\${m.importance}" min="1" max="10">
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="closeModal()">\${t('cancel')}</button>
          <button class="btn btn-primary" onclick="saveMemory(\${m.id})">\${t('update')}</button>
        </div>
      \`;
      document.getElementById('modal').classList.add('active');
    }

    // 메모리 저장
    async function saveMemory(id) {
      const content = document.getElementById('edit-content').value;
      const memory_type = document.getElementById('edit-type').value;
      const tags = document.getElementById('edit-tags').value.split(',').map(tg => tg.trim()).filter(Boolean);
      const importance = parseInt(document.getElementById('edit-importance').value);

      await api('/memories/' + id, {
        method: 'PUT',
        body: JSON.stringify({ content, memory_type, tags, importance })
      });

      closeModal();
      showToast(t('updated'));
      loadContent();
    }

    // 메모리 삭제
    async function deleteMemory(id) {
      if (!confirm(t('confirmDelete'))) return;

      await api('/memories/' + id, { method: 'DELETE' });
      showToast(t('deleted'));
      loadStats();
      loadContent();
    }

    // 모달 닫기
    function closeModal() {
      document.getElementById('modal').classList.remove('active');
    }

    // ESC로 모달 닫기
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });

    // 모달 외부 클릭으로 닫기
    document.getElementById('modal').addEventListener('click', e => {
      if (e.target.id === 'modal') closeModal();
    });

    // 초기화
    document.getElementById('lang-select').value = currentLang;
    updateUI();
  </script>
</body>
</html>`;
// ===== HTTP 서버 =====
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '/';
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    // JSON 응답 헬퍼
    const json = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    };
    // Body 파싱
    const parseBody = () => {
        return new Promise((resolve) => {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                }
                catch {
                    resolve({});
                }
            });
        });
    };
    try {
        // API 라우팅
        if (pathname.startsWith('/api')) {
            const apiPath = pathname.slice(4);
            const params = new URLSearchParams(parsedUrl.search || '');
            // GET /api/stats
            if (apiPath === '/stats' && req.method === 'GET') {
                return json(getStats());
            }
            // GET /api/memories
            if (apiPath === '/memories' && req.method === 'GET') {
                return json(getMemories(params));
            }
            // GET /api/memories/:id
            const memoryMatch = apiPath.match(/^\/memories\/(\d+)$/);
            if (memoryMatch) {
                const id = parseInt(memoryMatch[1]);
                if (req.method === 'GET') {
                    return json(getMemory(id));
                }
                if (req.method === 'PUT') {
                    const body = await parseBody();
                    return json(updateMemory(id, body));
                }
                if (req.method === 'DELETE') {
                    return json(deleteMemoryById(id));
                }
            }
            // GET /api/sessions
            if (apiPath === '/sessions' && req.method === 'GET') {
                return json(getSessions(params));
            }
            // GET /api/relations
            if (apiPath === '/relations' && req.method === 'GET') {
                const memoryId = params.get('memoryId');
                return json(getRelations(memoryId ? parseInt(memoryId) : undefined));
            }
            return json({ error: 'Not found' }, 404);
        }
        // HTML 페이지
        if (pathname === '/' || pathname === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(HTML_TEMPLATE);
            return;
        }
        // 404
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
    catch (error) {
        console.error('Error:', error);
        json({ error: String(error) }, 500);
    }
});
server.listen(PORT, '127.0.0.1', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🧠 Project Manager MCP Dashboard                          ║
║                                                              ║
║   Open: http://127.0.0.1:${PORT}                               ║
║   DB:   ${DB_PATH}
║                                                              ║
║   Languages: EN | KO | JA | ZH | DE | FR | ES               ║
║                                                              ║
║   Press Ctrl+C to stop                                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
