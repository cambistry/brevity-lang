// ═══════════════════════════════════════════════════════════════════════════════
// AST Node Constructors
//
// Every AST node is created through these functions. This is the contract
// between the parser (producer) and validate/codegen (consumers).
//
// Adding a new node type: add a constructor here first. If codegen doesn't
// handle it, you'll know immediately.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Program ──────────────────────────────────────────────────────────────────

export const program = (actors, dependencies) =>
  ({ type: 'Program', actors, dependencies });

export const actor = (name, { params = [], functions = [], stateVarDecls = [], initBody = [], initParams = [], constructorBody = [], asClauses = [], supertypes = [], declarationReturn = null, overloadMode = 'create' } = {}) =>
  ({ type: 'Actor', name, params, functions, stateVarDecls, initBody, initParams, constructorBody, asClauses, supertypes, declarationReturn, ...(overloadMode !== 'create' && { overloadMode }) });

export const ingestExpr = (defaultValue = null) =>
  ({ type: 'IngestExpr', defaultValue });

export const dependency = (name, { interface: iface = null, constructorParams = null, path = null, generic = false, destructures = null } = {}) =>
  ({ type: 'Dependency', name, interface: iface, constructorParams, path, generic, ...(destructures && { destructures }) });

export const fileParam = (name, { type = null, positional = false, defaultValue = null } = {}) =>
  ({ type: 'FileParam', name, paramType: type, positional, ...(defaultValue && { defaultValue }) });

// ── Declarations ─────────────────────────────────────────────────────────────

export const functionDecl = (name, params, body, { overloadMode = 'create', actorDef = null, emptyOverload = false } = {}) =>
  ({ type: 'FunctionDecl', name, params, body, ...(overloadMode !== 'create' && { overloadMode }), ...(actorDef && { actorDef }), ...(emptyOverload && { emptyOverload }) });

export const emitDecl = (name, params, { returnType = null, silent = false } = {}) =>
  ({ type: 'EmitDecl', name, params, returnType, silent });

export const onHandler = (source, eventName, params, body) =>
  ({ type: 'OnHandler', source, eventName, params, body });

export const refDecl = (name, typeName, value) =>
  ({ type: 'RefDecl', name, typeName, value });

export const bareTypeDecl = (name, typeName) =>
  ({ type: 'BareTypeDecl', name, typeName });

export const typedAssign = (name, typeName, value) =>
  ({ type: 'TypedAssign', name, typeName, value });

export const assign = (name, value) =>
  ({ type: 'Assign', name, value });

export const stateAssign = (name, value, { isRef = false } = {}) =>
  ({ type: 'StateAssign', name, value, ...(isRef && { isRef }) });

export const asClause = (targetType, negated, expr) =>
  ({ type: 'AsClause', targetType, negated, expr });

export const serviceCoercion = (name, ref, constraint, constructorParams = null) =>
  ({ type: 'ServiceCoercion', name, ref, constraint, constructorParams });

// ── Statements ───────────────────────────────────────────────────────────────

export const exprStatement = (expr) =>
  ({ type: 'ExprStatement', expr });

export const setStatement = (name, value, { updateOp = undefined } = {}) =>
  ({ type: 'SetStatement', name, value, ...(updateOp && { updateOp }) });

export const actorSetStatement = (name, args, { updateOp = undefined } = {}) =>
  ({ type: 'ActorSetStatement', name, args, ...(updateOp && { updateOp }) });

export const actorFieldSet = (objectName, fieldName, value, { updateOp = undefined } = {}) =>
  ({ type: 'ActorFieldSet', objectName, fieldName, value, ...(updateOp && { updateOp }) });

export const ifStatement = (cond, body) =>
  ({ type: 'IfStatement', cond, body });

export const whileStatement = (cond, body, negated) =>
  ({ type: 'WhileStatement', cond, body, negated });

export const spawnStatement = (call) =>
  ({ type: 'SpawnStatement', call });

// ── Returns ──────────────────────────────────────────────────────────────────

export const reply = (fields) =>
  ({ type: 'Reply', fields });

export const returnNode = (fields) =>
  ({ type: 'Return', fields });

export const implicitReturn = (expr, typeName = null) =>
  ({ type: 'ImplicitReturn', expr, typeName });

export const silentTerminator = () =>
  ({ type: 'SilentTerminator' });

// ── Expressions ──────────────────────────────────────────────────────────────

export const identifier = (name) =>
  ({ type: 'Identifier', name });

export const intLiteral = (value) =>
  ({ type: 'IntLiteral', value });

export const decimalLiteral = (value) =>
  ({ type: 'DecimalLiteral', value });

export const floatLiteral = (value) =>
  ({ type: 'FloatLiteral', value });

export const stringLiteral = (value) =>
  ({ type: 'StringLiteral', value });

export const htmlLiteral = (value) =>
  ({ type: 'HtmlLiteral', value });

export const boolLiteral = (value) =>
  ({ type: 'BoolLiteral', value });

export const nullLiteral = () =>
  ({ type: 'NullLiteral' });

export const listLiteral = (elements) =>
  ({ type: 'ListLiteral', elements });

export const binaryExpr = (op, left, right) =>
  ({ type: 'BinaryExpr', op, left, right });

export const functionCallExpr = (callee, args) =>
  ({ type: 'FunctionCallExpr', callee, args });

export const dotCallExpr = (object, method, args) =>
  ({ type: 'DotCallExpr', object, method, args });

export const dotAccess = (object, property) =>
  ({ type: 'DotAccess', object, property });

export const dotAccessExpr = (object, property) =>
  ({ type: 'DotAccessExpr', object, property });

export const indexExpr = (object, { index = null, key = null } = {}) =>
  ({ type: 'IndexExpr', object, index, key });

export const ifExpr = (cond, thenBranch, elseBranch) =>
  ({ type: 'IfExpr', cond, then: thenBranch, else: elseBranch });

export const ifBranch = ({ body = null, expr = null, typeName = null } = {}) =>
  ({ type: 'IfBranch', ...(body && { body }), ...(expr && { expr }), ...(typeName && { typeName }) });

export const overExpr = (collection, fn) =>
  ({ type: 'OverExpr', collection, fn });

export const reduceExpr = (initial, collection, fn) =>
  ({ type: 'ReduceExpr', initial, collection, fn });

export const fnRef = (name) =>
  ({ type: 'FnRef', name });

export const refArg = (name) =>
  ({ type: 'RefArg', name });

export const refRead = (name) =>
  ({ type: 'RefRead', name });

export const stateVar = (name) =>
  ({ type: 'StateVar', name });

// ── Function types ───────────────────────────────────────────────────────────

export const functionType = (inputs, outputs) =>
  ({ type: 'FunctionType', inputs, outputs });

export const functionNode = (params, body, { returnType = null, expr = null } = {}) =>
  ({ type: 'Function', params, body, returnType, ...(expr && { expr }) });

export const typedValue = (expr, typeName) =>
  ({ type: 'TypedValue', expr, typeName });

// ── Structures ───────────────────────────────────────────────────────────────

export const structureConstructor = (args) =>
  ({ type: 'StructureConstructor', args });

export const structureLiteral = (args) =>
  ({ type: 'StructureLiteral', args });

export const namedArgsBag = (fields) =>
  ({ type: 'NamedArgsBag', fields });

// ── Destructuring ────────────────────────────────────────────────────────────

export const destructureAssign = (pattern, source) =>
  ({ type: 'DestructureAssign', pattern, source });

export const listDestructure = (pattern, source) =>
  ({ type: 'ListDestructure', pattern, source });
