// statements.js — Statement generation for Rust codegen
import {
  G, inferLiteralType, rustIdent, rustType, convertFromValue, toJsonValue,
  forceJsonWrap, rsStore, stateKey, findRsAsClauseMatch, substituteCaptures,
  buildTypeEnv, fnReturnsFunction, resolveVarExpr,
} from './types.js';
import {
  genRustExpr, genRustIfExpr,
  genRustFnReturn, genRustFnCallExpr, genRecursiveFnDef,
  genRustCondition,
} from './expressions.js';

function genRustTypedAssign(s, typeEnv, fnDefs, sCtx, I, lines, i, body, mutableVars, fns, _functionAnalysis) {
      // as-clause interception
      if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && G.ctx.actorInfo.has(s.value.callee.name)) {
        const asClause = findRsAsClauseMatch(s.typeName, s.value.callee.name);
        if (asClause) {
          let val = genRustExpr(asClause.expr, typeEnv);
          if (s.typeName === 'Text' && asClause.expr.type === 'StringLiteral') val += '.to_string()';
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
          return true;
        }
        // Non-ref actor instantiation via TypedAssign
        const actorName = s.value.callee.name;
        sCtx.childActorRefs.set(s.name, actorName);
        {
          const childActor = G.ctx.actorInfo.get(actorName)?.actor;
          if (s.value.args.length > 0 || childActor?._supertypeBindings?.length > 0) {
            const initArgs = s.value.args.map(a => genRustExpr(a, typeEnv)).join(', ');
            lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&json!([${initArgs}]));`);
          }
        }
        return true;
      }
      if (s.value.type === 'IfExpr') {
        lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${genRustIfExpr(s.value, typeEnv, null, I, rustType(s.typeName))};`);
      } else if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && G.ctx.actorFnNames.has(s.value.callee.name)) {
        // Check if any args are function-typed (Function, FnRef) — need fn inlining
        const hasFunctionArgs = s.value.args.some(a =>
          a.type === 'Function' || a.type === 'FnRef');
        const fnDef = hasFunctionArgs && fns ? fns.find(f => f.name === s.value.callee.name) : null;
        if (fnDef && hasFunctionArgs) {
          // Inline the fn body, resolving function params
          const fnParams = fnDef.params || [];
          const fnBody = fnDef.body || [];
          const fnReply = fnBody.find(bs => bs.type === 'Reply');
          const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
          const namedBagP = s.value.args.find(a => a.type === 'NamedArgsBag');
          const blockLines = [];
          const fnFunctionParams = new Map();
          let pPosIdx = 0;
          for (const pp of fnParams) {
            let arg;
            if (pp.positional) {
              arg = callArgs[pPosIdx++];
            } else if (namedBagP && namedBagP.fields && (pp.key || pp.name) in namedBagP.fields) {
              arg = namedBagP.fields[pp.key || pp.name];
            }
            if (arg?.type === 'Function') {
              fnFunctionParams.set(pp.name, { kind: 'inline', node: arg });
              continue;
            }
            if (arg?.type === 'FnRef') {
              const resolved = fnDefs.get(arg.name);
              if (resolved) {
                fnFunctionParams.set(pp.name, { kind: 'inline', node: resolved.node });
              } else {
                fnFunctionParams.set(pp.name, { kind: 'method', name: arg.name });
              }
              continue;
            }
            const pt = pp.type || inferLiteralType(arg);
            let argExpr = arg ? genRustExpr(arg, typeEnv) : 'Value::Null';
            if (pt === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
            if (pt) {
              blockLines.push(`${I}    let ${rustIdent(pp.name)}: ${rustType(pt)} = ${argExpr};`);
            } else {
              blockLines.push(`${I}    let ${rustIdent(pp.name)} = ${argExpr};`);
            }
          }
          // Process fn body statements
          const fnTypeEnv = buildTypeEnv(fnParams, fnBody);
          // Helper to resolve function params in nested expressions
          function genExprResolvingFunctions(expr) {
            if (expr.type === 'FunctionCallExpr') {
              const callee = expr.callee?.name;
              const cp = callee ? fnFunctionParams.get(callee) : null;
              if (cp && cp.kind === 'inline') {
                const func = cp.node;
                const fparams = func.params || [];
                const fargs = expr.args.filter(a => a.type !== 'NamedArgsBag');
                const bindings = [];
                let fIdx = 0;
                for (const fp of fparams) {
                  const farg = fargs[fIdx++];
                  const fargExpr = farg ? genExprResolvingFunctions(farg) : 'Value::Null';
                  const fpt = fp.type || inferLiteralType(farg);
                  if (fpt) bindings.push(`let ${rustIdent(fp.name)}: ${rustType(fpt)} = ${fargExpr};`);
                  else bindings.push(`let ${rustIdent(fp.name)} = ${fargExpr};`);
                }
                let fret = func.expr;
                if (!fret && func.body) {
                  const ir = func.body.find(st => st.type === 'ImplicitReturn');
                  if (ir) fret = ir.expr;
                }
                const retCode = fret ? genExprResolvingFunctions(fret) : 'Value::Null';
                if (bindings.length > 0) return `{ ${bindings.join(' ')} ${retCode} }`;
                return retCode;
              }
              if (cp && cp.kind === 'method') {
                const fargs = expr.args.filter(a => a.type !== 'NamedArgsBag');
                const argVals = fargs.map(a => forceJsonWrap(genExprResolvingFunctions(a)));
                return `self.${cp.name}_fn(&Structure { positional: vec![${argVals.join(', ')}], named: Map::new() }).one()`;
              }
            }
            return genRustExpr(expr, fnTypeEnv);
          }
          for (const bs of fnBody) {
            if (bs.type === 'Reply') continue;
            if ((bs.type === 'TypedAssign' || bs.type === 'Assign') && bs.value.type === 'FunctionCallExpr') {
              const innerCallee = bs.value.callee?.name;
              const cp = innerCallee ? fnFunctionParams.get(innerCallee) : null;
              if (cp) {
                if (cp.kind === 'inline') {
                  const innerFunc = cp.node;
                  const innerParams = innerFunc.params || [];
                  const innerArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
                  const innerLines = [];
                  let iiIdx = 0;
                  for (const ip of innerParams) {
                    const iarg = innerArgs[iiIdx++];
                    const itype = ip.type || inferLiteralType(iarg);
                    const iexpr = iarg ? genRustExpr(iarg, fnTypeEnv) : 'Value::Null';
                    if (itype) {
                      innerLines.push(`${I}        let ${rustIdent(ip.name)}: ${rustType(itype)} = ${iexpr};`);
                    } else {
                      innerLines.push(`${I}        let ${rustIdent(ip.name)} = ${iexpr};`);
                    }
                  }
                  let innerRetExprB = innerFunc.expr;
                  if (!innerRetExprB && innerFunc.body) {
                    const implRetB = innerFunc.body.find(st => st.type === 'ImplicitReturn');
                    if (implRetB) innerRetExprB = implRetB.expr;
                  }
                  const innerExpr = innerRetExprB ? genRustExpr(innerRetExprB, fnTypeEnv) : 'Value::Null';
                  const rtype = bs.type === 'TypedAssign' ? bs.typeName : inferLiteralType(bs.value);
                  if (innerLines.length > 0) {
                    const innerBlock = `{\n${innerLines.join('\n')}\n${I}        ${innerExpr}\n${I}    }`;
                    blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rtype ? rustType(rtype) : 'Value'} = ${innerBlock};`);
                  } else {
                    blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rtype ? rustType(rtype) : 'Value'} = ${innerExpr};`);
                  }
                } else if (cp.kind === 'method') {
                  const innerArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
                  const argVals = innerArgs.map(a => forceJsonWrap(genRustExpr(a, fnTypeEnv)));
                  const rtype = bs.type === 'TypedAssign' ? bs.typeName : null;
                  const fnCall = `self.${cp.name}_fn(&Structure { positional: vec![${argVals.join(', ')}], named: Map::new() }).one()`;
                  blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rtype ? rustType(rtype) : 'Value'} = ${rtype ? convertFromValue(fnCall, rtype) : fnCall};`);
                }
                continue;
              }
            }
            if (bs.type === 'TypedAssign') {
              blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${genRustExpr(bs.value, fnTypeEnv)};`);
            } else if (bs.type === 'Assign') {
              blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${genRustExpr(bs.value, fnTypeEnv)};`);
            }
          }
          // Extract return value from fn reply, using function-aware resolver
          if (fnReply) {
            const retFields = fnReply.fields.filter(f => f.positional);
            if (retFields.length === 1) {
              const rf = retFields[0];
              const rfExpr = rf.expr || (rf.name ? { type: 'Identifier', name: rf.name } : null);
              if (rfExpr) {
                blockLines.push(`${I}    ${genExprResolvingFunctions(rfExpr)}`);
              }
            }
          }
          const block = `{\n${blockLines.join('\n')}\n${I}}`;
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${block};`);
        } else {
          const callExpr = genRustFnCallExpr(s.value, typeEnv);
          if (s.typeName === 'Structure') {
            lines.push(`${I}let ${rustIdent(s.name)} = ${callExpr};`);
          } else {
            const converted = convertFromValue(`${callExpr}.one()`, s.typeName);
            lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${converted};`);
          }
        }
      } else if (s.typeName === 'Structure') {
        lines.push(`${I}let ${rustIdent(s.name)} = ${genRustExpr(s.value, typeEnv)};`);
      } else if (s.value.type === 'StructureConstructor') {
        const expr = genRustExpr(s.value, typeEnv);
        const converted = convertFromValue(`${expr}.one()`, s.typeName);
        lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${converted};`);
      } else if (s.value.type === 'FunctionCallExpr') {
        const calleeName = s.value.callee?.name;
        const tracked = calleeName ? fnDefs.get(calleeName) : null;
        if (tracked && tracked.recursive) {
          // Call the generated recursive function directly
          const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
          const argExprs = callArgs.map(a => genRustExpr(a, typeEnv)).join(', ');
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${rustIdent(calleeName)}(${argExprs});`);
        } else if (tracked) {
          // Inline the closure body with param bindings in a block expression
          const funcNode = tracked.node;
          const funcParams = funcNode.params || [];
          const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
          const namedArgsBag = s.value.args.find(a => a.type === 'NamedArgsBag');

          // Separate return expression from body statements
          let innerExpr;
          let returnNode = null;
          let bodyStmts = [];
          if (funcNode.body) {
            bodyStmts = funcNode.body.filter(st => st.type !== 'ImplicitReturn' && st.type !== 'Return');
            const implRet = funcNode.body.find(st => st.type === 'ImplicitReturn');
            returnNode = funcNode.body.find(st => st.type === 'Return');
            innerExpr = implRet ? implRet.expr : null;
            // If no ImplicitReturn, use last body statement's variable as return
            if (!innerExpr && !returnNode && bodyStmts.length > 0) {
              const lastStmt = bodyStmts[bodyStmts.length - 1];
              if (lastStmt.type === 'SetStatement') {
                // Set returns the new ref value
                innerExpr = { type: 'RefRead', name: lastStmt.name };
              } else if (lastStmt.name) {
                innerExpr = { type: 'Identifier', name: lastStmt.name };
              } else {
                // Body has statements but no named return — evaluate to null
                innerExpr = { type: 'NullLiteral' };
              }
            }
          } else {
            innerExpr = funcNode.expr;
          }

          if (innerExpr || returnNode) {
            const hasBlockContent = funcParams.length > 0 || bodyStmts.length > 0;
            const blockLines = [];

            // Bind function params to call-site arguments
            const fnParams = new Map();
            let posIdx = 0;
            for (let pi = 0; pi < funcParams.length; pi++) {
              const param = funcParams[pi];
              let arg;
              const lookupKey = param.key || param.name;
              if (param.positional) {
                arg = callArgs[posIdx++];
              } else if (namedArgsBag && namedArgsBag.fields && lookupKey in namedArgsBag.fields) {
                arg = namedArgsBag.fields[lookupKey];
              }
              // Track function args (Function literal, FnRef)
              if (arg?.type === 'Function') {
                fnParams.set(param.name, { kind: 'inline', node: arg });
                continue;
              }
              if (arg?.type === 'FnRef') {
                if (G.ctx.actorFnNames.has(arg.name)) {
                  fnParams.set(param.name, { kind: 'method', name: arg.name });
                } else {
                  const resolved = fnDefs.get(arg.name);
                  if (resolved) {
                    fnParams.set(param.name, { kind: 'inline', node: resolved.node });
                  } else {
                    fnParams.set(param.name, { kind: 'method', name: arg.name });
                  }
                }
                continue;
              }
              const paramType = param.type || inferLiteralType(arg) || (arg?.type === 'Identifier' ? typeEnv.get(arg.name) : null);
              let argExpr = arg ? genRustExpr(arg, typeEnv) : 'Value::Null';
              if (paramType) {
                if (paramType === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
                blockLines.push(`${I}    let ${param.name}: ${rustType(paramType)} = ${argExpr};`);
              } else {
                blockLines.push(`${I}    let ${param.name} = ${argExpr};`);
              }
            }

            // Track nested function definitions within inlined body
            const innerFnDefs = new Map();
            for (const bs of bodyStmts) {
              if ((bs.type === 'Assign' || bs.type === 'TypedAssign') && bs.value.type === 'Function') {
                innerFnDefs.set(bs.name, bs.value);
              }
            }

            // Emit body statements (excluding ImplicitReturn/Return)
            for (const bs of bodyStmts) {
              // Skip nested function definitions — they'll be inlined at call sites
              if ((bs.type === 'Assign' || bs.type === 'TypedAssign') && bs.value.type === 'Function' && innerFnDefs.has(bs.name)) {
                continue;
              }
              // Handle calls to nested function definitions
              if ((bs.type === 'TypedAssign' || bs.type === 'Assign') && bs.value.type === 'FunctionCallExpr') {
                const innerCallee = bs.value.callee?.name;
                const innerFn = innerCallee ? innerFnDefs.get(innerCallee) : null;
                if (innerFn) {
                  // Inline the nested function
                  const nfParams = innerFn.params || [];
                  const nfArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
                  const nfLines = [];
                  let nfPosIdx = 0;
                  for (const np of nfParams) {
                    const narg = nfArgs[nfPosIdx++];
                    const ntype = np.type || inferLiteralType(narg) || (narg?.type === 'Identifier' ? typeEnv.get(narg.name) : null);
                    const nexpr = narg ? genRustExpr(narg, typeEnv) : 'Value::Null';
                    if (ntype) {
                      nfLines.push(`${I}        let ${rustIdent(np.name)}: ${rustType(ntype)} = ${nexpr};`);
                    } else {
                      nfLines.push(`${I}        let ${rustIdent(np.name)} = ${nexpr};`);
                    }
                  }
                  let nfRetExpr = innerFn.expr;
                  if (!nfRetExpr && innerFn.body) {
                    const implRetN = innerFn.body.find(st => st.type === 'ImplicitReturn');
                    if (implRetN) nfRetExpr = implRetN.expr;
                  }
                  const nfExpr = nfRetExpr ? genRustExpr(nfRetExpr, typeEnv) : 'Value::Null';
                  const rtype = bs.type === 'TypedAssign' ? bs.typeName : inferLiteralType(bs.value);
                  if (nfLines.length > 0) {
                    const nfBlock = `{\n${nfLines.join('\n')}\n${I}        ${nfExpr}\n${I}    }`;
                    if (rtype) {
                      blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${nfBlock};`);
                    } else {
                      blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${nfBlock};`);
                    }
                  } else {
                    if (rtype) {
                      blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${nfExpr};`);
                    } else {
                      blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${nfExpr};`);
                    }
                  }
                  continue;
                }
              }
              // Handle function param calls: f(n) where f is a function arg
              if ((bs.type === 'TypedAssign' || bs.type === 'Assign') && bs.value.type === 'FunctionCallExpr') {
                const innerCallee = bs.value.callee?.name;
                const cp = innerCallee ? fnParams.get(innerCallee) : null;
                if (cp) {
                  if (cp.kind === 'inline') {
                    // Inline the function
                    const innerFunc = cp.node;
                    const innerParams = innerFunc.params || [];
                    const innerArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
                    const innerLines = [];
                    let iposIdx = 0;
                    for (const ip of innerParams) {
                      const iarg = innerArgs[iposIdx++];
                      const itype = ip.type || inferLiteralType(iarg) || (iarg?.type === 'Identifier' ? typeEnv.get(iarg.name) : null);
                      const iexpr = iarg ? genRustExpr(iarg, typeEnv) : 'Value::Null';
                      if (itype) {
                        innerLines.push(`${I}        let ${rustIdent(ip.name)}: ${rustType(itype)} = ${iexpr};`);
                      } else {
                        innerLines.push(`${I}        let ${rustIdent(ip.name)} = ${iexpr};`);
                      }
                    }
                    let innerRetExprH = innerFunc.expr;
                    if (!innerRetExprH && innerFunc.body) {
                      const implRetH = innerFunc.body.find(st => st.type === 'ImplicitReturn');
                      if (implRetH) innerRetExprH = implRetH.expr;
                    }
                    const innerExpr = innerRetExprH ? genRustExpr(innerRetExprH, typeEnv) : 'Value::Null';
                    const rtype = bs.type === 'TypedAssign' ? bs.typeName : inferLiteralType(bs.value);
                    if (innerLines.length > 0) {
                      const innerBlock = `{\n${innerLines.join('\n')}\n${I}        ${innerExpr}\n${I}    }`;
                      if (rtype) {
                        blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${innerBlock};`);
                      } else {
                        blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${innerBlock};`);
                      }
                    } else {
                      if (rtype) {
                        blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${innerExpr};`);
                      } else {
                        blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${innerExpr};`);
                      }
                    }
                  } else if (cp.kind === 'method') {
                    // Call the actor fn
                    const innerArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
                    const argVals = innerArgs.map(a => {
                      const raw = genRustExpr(a, typeEnv);
                      const t = a.type === 'Identifier' ? typeEnv.get(a.name) : inferLiteralType(a);
                      return forceJsonWrap(toJsonValue(raw, t));
                    });
                    const rtype = bs.type === 'TypedAssign' ? bs.typeName : null;
                    const fnCall = `self.${cp.name}_fn(&Structure { positional: vec![${argVals.join(', ')}], named: Map::new() }).one()`;
                    if (rtype) {
                      blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${convertFromValue(fnCall, rtype)};`);
                    } else {
                      blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${fnCall};`);
                    }
                  }
                  continue;
                }
              }
              if (bs.type === 'TypedAssign') {
                const bsVal = substituteCaptures(bs.value, tracked.captures);
                if (bs.typeName === 'Structure' && bsVal.type === 'FunctionCallExpr') {
                  blockLines.push(`${I}    let ${bs.name} = ${genRustFnCallExpr(bsVal, typeEnv)};`);
                } else {
                  blockLines.push(`${I}    let ${bs.name}: ${rustType(bs.typeName)} = ${genRustExpr(bsVal, typeEnv)};`);
                }
              } else if (bs.type === 'Assign') {
                const bsVal = substituteCaptures(bs.value, tracked.captures);
                const knownType = inferLiteralType(bs.value);
                if (knownType) {
                  blockLines.push(`${I}    let ${bs.name}: ${rustType(knownType)} = ${genRustExpr(bsVal, typeEnv)};`);
                } else {
                  blockLines.push(`${I}    let ${bs.name} = ${genRustExpr(bsVal, typeEnv)};`);
                }
              } else if (bs.type === 'WhileStatement') {
                blockLines.push(genRustWhileStatement(bs, typeEnv, `${I}    `));
              } else if (bs.type === 'StateAssign') {
                const bsVal = genRustExpr(bs.value, typeEnv);
                const t = typeEnv.get('$' + bs.name) || inferLiteralType(bs.value);
                blockLines.push(`${I}    self.state.insert("${stateKey(bs.name)}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
              } else if (bs.type === 'SetStatement') {
                const bsVal = genRustExpr(bs.value, typeEnv);
                const t = typeEnv.get(bs.name) || inferLiteralType(bs.value);
                blockLines.push(`${I}    ${rsStore(bs.name)}.insert("${stateKey(bs.name)}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
              } else if (bs.type === 'ExprStatement') {
                if (bs.expr.type === 'IfExpr') {
                  blockLines.push(genRustIfStatement(bs.expr, typeEnv, `${I}    `));
                } else {
                  blockLines.push(`${I}    ${genRustExpr(bs.expr, typeEnv)};`);
                }
              }
            }

            if (returnNode) {
              // Return node: build a Structure from fields, then extract as needed
              const retStructExpr = genRustFnReturn(returnNode.fields, typeEnv);
              if (s.typeName === 'Structure') {
                blockLines.push(`${I}    ${retStructExpr}`);
                lines.push(`${I}let ${rustIdent(s.name)} = {\n${blockLines.join('\n')}\n${I}};`);
              } else {
                const converted = convertFromValue(`${retStructExpr}.one()`, s.typeName);
                blockLines.push(`${I}    ${converted}`);
                lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = {\n${blockLines.join('\n')}\n${I}};`);
              }
            } else if (hasBlockContent) {
              // Return expression as block value
              const substituted = substituteCaptures(innerExpr, tracked.captures);
              const valExpr = genRustExpr(substituted, typeEnv);
              const converted = convertFromValue(`json!(${valExpr})`, s.typeName);
              blockLines.push(`${I}    ${converted}`);
              lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = {\n${blockLines.join('\n')}\n${I}};`);
            } else {
              // No params, no body — simple inline
              const substituted = substituteCaptures(innerExpr, tracked.captures);
              const valExpr = genRustExpr(substituted, typeEnv);
              const converted = convertFromValue(`json!(${valExpr})`, s.typeName);
              lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${converted};`);
            }
          }
        } else {
          const exprCtx = (s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr') ? { fnDefs } : undefined;
          let val = genRustExpr(s.value, typeEnv, exprCtx);
          const isIterExpr = s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr';
          const isFnCall = s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier';
          const calleeFnTyped = isFnCall && (() => {
            const ct = typeEnv.get(s.value.callee.name);
            return ct && (ct === 'Function' || (typeof ct === 'string' && ct.includes('->')));
          })();
          if (isIterExpr && s.typeName && rustType(s.typeName) !== 'Value') {
            val = convertFromValue(val, s.typeName);
          } else if (calleeFnTyped && s.typeName && rustType(s.typeName) !== 'Value') {
            val = convertFromValue(val, s.typeName);
          } else if ((s.value.type === 'StateVar' || s.value.type === 'RefRead') && s.typeName && rustType(s.typeName) !== 'Value') {
            val = convertFromValue(val, s.typeName);
          } else if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
          if (!isIterExpr && s.typeName && s.typeName.includes('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `json!(${val})`;
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
        }
      } else if (s.value?.type === 'DotCallExpr' && (() => {
        const dotObj = s.value.object;
        const dn = dotObj.type === 'RefRead' ? dotObj.name : (dotObj.type === 'Identifier' ? dotObj.name : null);
        return dn && (G.ctx.remoteInstanceVars.has(dn) || G.ctx.constructsProxyVars.has(dn));
      })()) {
        // Remote or constructs proxy DotCallExpr in TypedAssign — await response
        const expr = s.value;
        const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : expr.object.name;
        const isProxy = G.ctx.constructsProxyVars.has(dotObjName);
        if (isProxy) {
          const proxyName = G.ctx.constructsVarToProxy.get(dotObjName);
          const method = JSON.stringify('@' + expr.method);
          const childCall = `self.child_dispatch("${proxyName}", ${method}, &json!({}))`;
          const accessor = `{ let _cr = ${childCall}; _cr.get("${s.name}").cloned().unwrap_or_else(|| { let _cs = Structure::pack(&_cr); _cs.one() }) }`;
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${convertFromValue(accessor, s.typeName)};`);
        } else {
          // Remote instance: send + await_response
          const to = `self.state.get("${dotObjName}").and_then(|v| v.as_str()).unwrap_or("").to_string()`;
          const method = JSON.stringify(expr.method);
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = {`);
          lines.push(`${I}    let seq = self.send_seq.get();`);
          lines.push(`${I}    self.send_seq.set(seq + 1);`);
          lines.push(`${I}    let send_id = seq.to_string();`);
          lines.push(`${I}    let mut send_msg = Map::new();`);
          lines.push(`${I}    send_msg.insert("id".to_string(), json!(send_id.clone()));`);
          lines.push(`${I}    send_msg.insert("op".to_string(), json!(${method}));`);
          lines.push(`${I}    send_msg.insert("to".to_string(), json!(${to}));`);
          lines.push(`${I}    let _ = self.binding.send(Value::Object(send_msg));`);
          lines.push(`${I}    let _re = self.await_response(&send_id);`);
          lines.push(`${I}    ${convertFromValue(`_re.get("${s.name}").cloned().unwrap_or(Value::Null)`, s.typeName)}`);
          lines.push(`${I}};`);
        }
      } else {
        const exprCtx = (s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr') ? { fnDefs } : undefined;
        let val = genRustExpr(s.value, typeEnv, exprCtx);
        const isIterExpr2 = s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr';
        if (isIterExpr2 && s.typeName && rustType(s.typeName) !== 'Value') {
          val = convertFromValue(val, s.typeName);
        } else if ((s.value.type === 'StateVar' || s.value.type === 'RefRead') && s.typeName && rustType(s.typeName) !== 'Value') {
          val = convertFromValue(val, s.typeName);
        } else if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
        if (!isIterExpr2 && s.typeName && s.typeName.includes('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `json!(${val})`;
        lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
      }
      return false;
}

// Handles DestructureAssign statements.

function genRustDestructureAssign(s, typeEnv, sCtx, I, lines, i, fnDefs) {
      if (s.source.type === 'FunctionCallExpr') {
        // Inline function and destructure the result
        const calleeName = s.source.callee?.name;
        const tracked = calleeName ? fnDefs.get(calleeName) : null;
        if (tracked) {
          const funcNode = tracked.node;
          const funcParams = funcNode.params || [];
          const callArgs = s.source.args.filter(a => a.type !== 'NamedArgsBag');
          const namedArgsBagD = s.source.args.find(a => a.type === 'NamedArgsBag');
          const fnBodyStmts = funcNode.body ? funcNode.body.filter(st => st.type !== 'ImplicitReturn' && st.type !== 'Return') : [];
          const fnReturnNode = funcNode.body ? funcNode.body.find(st => st.type === 'Return') : null;
          const fnImplRet = funcNode.body ? funcNode.body.find(st => st.type === 'ImplicitReturn') : null;

          const tempName = `_fr${G.ctx.fnTempCounter++}`;
          const blockLines = [];
          let posIdxD = 0;
          for (let pi = 0; pi < funcParams.length; pi++) {
            const param = funcParams[pi];
            let arg;
            const lookupKey = param.key || param.name;
            if (param.positional) {
              arg = callArgs[posIdxD++];
            } else if (namedArgsBagD && namedArgsBagD.fields && lookupKey in namedArgsBagD.fields) {
              arg = namedArgsBagD.fields[lookupKey];
            }
            const paramType = param.type || inferLiteralType(arg) || (arg?.type === 'Identifier' ? typeEnv.get(arg.name) : null);
            let argExpr = arg ? genRustExpr(arg, typeEnv) : 'Value::Null';
            if (paramType) {
              if (paramType === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
              blockLines.push(`${I}    let ${param.name}: ${rustType(paramType)} = ${argExpr};`);
            } else {
              blockLines.push(`${I}    let ${param.name} = ${argExpr};`);
            }
          }
          for (const bs of fnBodyStmts) {
            if (bs.type === 'TypedAssign') {
              if (bs.typeName === 'Structure' && bs.value.type === 'FunctionCallExpr') {
                blockLines.push(`${I}    let ${bs.name} = ${genRustFnCallExpr(bs.value, typeEnv)};`);
              } else {
                blockLines.push(`${I}    let ${bs.name}: ${rustType(bs.typeName)} = ${genRustExpr(bs.value, typeEnv)};`);
              }
            } else if (bs.type === 'Assign') {
              const knownType = inferLiteralType(bs.value);
              if (knownType) {
                blockLines.push(`${I}    let ${bs.name}: ${rustType(knownType)} = ${genRustExpr(bs.value, typeEnv)};`);
              } else {
                blockLines.push(`${I}    let ${bs.name} = ${genRustExpr(bs.value, typeEnv)};`);
              }
            } else if (bs.type === 'SetStatement') {
              const bsVal = genRustExpr(bs.value, typeEnv);
              const t = typeEnv.get(bs.name) || inferLiteralType(bs.value);
              blockLines.push(`${I}    ${rsStore(bs.name)}.insert("${stateKey(bs.name)}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
            } else if (bs.type === 'StateAssign') {
              const bsVal = genRustExpr(bs.value, typeEnv);
              const t = typeEnv.get('$' + bs.name) || inferLiteralType(bs.value);
              blockLines.push(`${I}    self.state.insert("${stateKey(bs.name)}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
            } else if (bs.type === 'WhileStatement') {
              blockLines.push(genRustWhileStatement(bs, typeEnv, `${I}    `));
            }
          }
          if (fnReturnNode) {
            blockLines.push(`${I}    ${genRustFnReturn(fnReturnNode.fields, typeEnv)}`);
          } else if (fnImplRet) {
            const valExpr = genRustExpr(fnImplRet.expr, typeEnv);
            blockLines.push(`${I}    Structure { positional: vec![json!(${valExpr})], named: Map::new() }`);
          }
          lines.push(`${I}let ${tempName} = {\n${blockLines.join('\n')}\n${I}};`);
          for (const item of s.pattern) {
            if (item.discard) continue;
            if (item.named) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.name)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.key !== undefined) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.key)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.positional) {
              const accessor = `${tempName}.positional.get(${item.idx}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            }
          }
        } else if (calleeName && G.ctx.emitNames.has(calleeName)) {
          // Emit call in destructure context — emit_await returns Structure
          const tempName = `_r${G.ctx.fnTempCounter++}`;
          const emitExpr = genRustExpr(s.source, typeEnv);
          lines.push(`${I}let ${tempName} = Structure::pack(&${emitExpr});`);
          for (const item of s.pattern) {
            if (item.discard) continue;
            if (item.named) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.name)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.key !== undefined) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.key)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.positional) {
              const accessor = `${tempName}.positional.get(${item.idx}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            }
          }
        } else if (calleeName && G.ctx.actorFnNames.has(calleeName)) {
          const tempName = `_r${G.ctx.fnTempCounter++}`;
          const callExpr = genRustFnCallExpr(s.source, typeEnv);
          lines.push(`${I}let ${tempName} = ${callExpr};`);
          for (const item of s.pattern) {
            if (item.discard) continue;
            if (item.named) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.name)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.key !== undefined) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.key)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.positional) {
              const accessor = `${tempName}.positional.get(${item.idx}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            }
          }
        }
      } else if (s.source.type === 'DotCallExpr') {
        const expr = s.source;
        const isChild = (expr.object.type === 'FunctionCallExpr' && expr.object.callee?.type === 'Identifier' && G.ctx.actorInfo.has(expr.object.callee.name)) ||
                        (expr.object.type === 'RefRead' && sCtx?.childActorRefs?.has(expr.object.name)) ||
                        (expr.object.type === 'Identifier' && sCtx?.childActorRefs?.has(expr.object.name));
        if (isChild) {
          // Child actor dispatch — call local method directly
          let actorName;
          if (expr.object.type === 'RefRead' || expr.object.type === 'Identifier') {
            actorName = sCtx.childActorRefs.get(expr.object.name);
          } else {
            actorName = expr.object.callee.name;
          }
          if (expr.object.type === 'FunctionCallExpr') {
            const childActorObj = G.ctx.actorInfo.get(actorName)?.actor;
            if (expr.object.args.length > 0 || childActorObj?._supertypeBindings?.length > 0) {
              const initArgs = expr.object.args.map(a => genRustExpr(a, typeEnv)).join(', ');
              lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&json!([${initArgs}]));`);
            }
          }
          const method = JSON.stringify('@' + expr.method);
          // Build payload from method args
          const positional = expr.args.filter(a => a.positional);
          const named = expr.args.filter(a => !a.positional);
          let payload;
          if (positional.length > 0 && named.length > 0) {
            const posVals = positional.map(a => genRustExpr(a.expr, typeEnv)).join(', ');
            const namedEntries = named.map(a => `"${a.name}": ${genRustExpr(a.expr || { type: 'Identifier', name: a.name }, typeEnv)}`).join(', ');
            payload = `json!([${posVals}, {${namedEntries}}])`;
          } else if (positional.length > 0) {
            const posVals = positional.map(a => genRustExpr(a.expr, typeEnv)).join(', ');
            payload = `json!([${posVals}])`;
          } else if (named.length > 0) {
            const namedEntries = named.map(a => `"${a.name}": ${genRustExpr(a.expr || { type: 'Identifier', name: a.name }, typeEnv)}`).join(', ');
            payload = `json!({${namedEntries}})`;
          } else {
            payload = 'json!({})';
          }
          const tempName = `_dc${G.ctx.fnTempCounter++}`;
          lines.push(`${I}let ${tempName} = self.child_${actorName.toLowerCase()}_dispatch(${method}, &${payload});`);
          // Destructure the response
          for (const item of s.pattern) {
            if (item.discard) continue;
            const key = item.key || item.name;
            const accessor = `${tempName}.get("${key}").cloned().unwrap_or(Value::Null)`;
            if (item.type) {
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else {
              lines.push(`${I}let ${item.name} = ${accessor};`);
            }
          }
        } else {
          // External DotCallExpr await: send outgoing message, then await response on stdin
          const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : (expr.object.type === 'Identifier' ? expr.object.name : null);
          // Constructs proxy: dispatch through child_dispatch, extract named fields
          const isConstructsProxyD = dotObjName && G.ctx.constructsProxyVars.has(dotObjName);
          if (isConstructsProxyD) {
            const childRef = JSON.stringify(G.ctx.constructsVarToProxy.get(dotObjName));
            const method = JSON.stringify('@' + expr.method);
            const named = expr.args.filter(a => !a.positional);
            const positional = expr.args.filter(a => a.positional);
            const genArgVal = a => a.expr ? genRustExpr(a.expr, typeEnv) : rustIdent(a.name);
            let payload;
            if (positional.length === 0 && named.length === 0) {
              payload = 'json!({})';
            } else if (named.length > 0) {
              const fields = named.map(a => `"${a.name}": ${genArgVal(a)}`).join(', ');
              payload = `json!({${fields}})`;
            } else {
              const vals = positional.map(genArgVal).join(', ');
              payload = `json!([${vals}])`;
            }
            const tempName = `_dc${G.ctx.fnTempCounter++}`;
            lines.push(`${I}let ${tempName} = self.child_dispatch(${childRef}, ${method}, &${payload});`);
            for (const item of s.pattern) {
              if (item.discard) continue;
              const key = item.key || item.name;
              const accessor = `${tempName}.get("${key}").cloned().unwrap_or(Value::Null)`;
              if (item.type) {
                lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
              } else {
                lines.push(`${I}let ${item.name} = ${accessor};`);
              }
            }
          } else
          // Check for wrapped child dispatch
          {const isWrappedChildD = dotObjName && G.ctx.stateVarNames.has(dotObjName) && !G.ctx.constructsProxyVars.has(dotObjName) && (G.ctx.stateVarDecls?.find(d => d.name === dotObjName)?.typeName === 'Anything' || (expr.object.type === 'Identifier' && !G.ctx.actorInfo.has(dotObjName) && !G.ctx.remoteInstanceVars.has(dotObjName)));
          if (isWrappedChildD) {
            const childRef = `self.state.get("${dotObjName}").and_then(|v| v.as_str()).unwrap_or("").to_string()`;
            const method = JSON.stringify('@' + expr.method);
            const named = expr.args.filter(a => !a.positional);
            const positional = expr.args.filter(a => a.positional);
            const genArgVal = a => a.expr ? genRustExpr(a.expr, typeEnv) : rustIdent(a.name);
            let payload;
            if (positional.length === 0 && named.length === 0) {
              payload = 'json!({})';
            } else if (named.length > 0) {
              const fields = named.map(a => `"${a.name}": ${genArgVal(a)}`).join(', ');
              payload = `json!({${fields}})`;
            } else {
              const vals = positional.map(genArgVal).join(', ');
              payload = `json!([${vals}])`;
            }
            const tempName = `_dc${G.ctx.fnTempCounter++}`;
            lines.push(`${I}let _cn = ${childRef};`);
            lines.push(`${I}let ${tempName} = self.child_dispatch(&_cn, ${method}, &${payload});`);
            for (const item of s.pattern) {
              if (item.discard) continue;
              const key = item.key || item.name;
              const accessor = `${tempName}.get("${key}").cloned().unwrap_or(Value::Null)`;
              if (item.type) {
                lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
              } else {
                lines.push(`${I}let ${item.name} = ${accessor};`);
              }
            }
          } else {
          const isRemoteInst = dotObjName && G.ctx.remoteInstanceVars.has(dotObjName);
          const named = expr.args.filter(a => !a.positional);
          const to = isRemoteInst
            ? `self.state.get("${dotObjName}").and_then(|v| v.as_str()).unwrap_or("").to_string().to_string()`
            : `${JSON.stringify(expr.object.name)}.to_string()`;
          const method = isRemoteInst ? JSON.stringify(expr.method) : JSON.stringify('@' + expr.method);
          const positional = expr.args.filter(a => a.positional);
          const genArgVal = a => a.expr ? genRustExpr(a.expr, typeEnv) : genRustExpr({ type: 'Identifier', name: a.name }, typeEnv);
          let opJson;
          if (positional.length === 0 && named.length === 0) {
            opJson = `json!(${method})`;
          } else if (positional.length > 0 && named.length > 0) {
            const posVals = positional.map(genArgVal).join(', ');
            const namedFields = named.map(a => `"${a.name}": ${genArgVal(a)}`).join(', ');
            opJson = `json!([${posVals}, {${namedFields}}, ${method}])`;
          } else if (named.length > 0) {
            const namedFields = named.map(a => `"${a.name}": ${genArgVal(a)}`).join(', ');
            opJson = `json!([{${namedFields}}, ${method}])`;
          } else {
            const posVals = positional.map(genArgVal).join(', ');
            opJson = `json!([[${posVals}], ${method}])`;
          }
          const tempName = `_dc${G.ctx.fnTempCounter++}`;
          lines.push(`${I}let ${tempName}_id = {`);
          lines.push(`${I}    let seq = self.send_seq.get();`);
          lines.push(`${I}    self.send_seq.set(seq + 1);`);
          lines.push(`${I}    let send_id = seq.to_string();`);
          lines.push(`${I}    let mut send_msg = Map::new();`);
          lines.push(`${I}    send_msg.insert("id".to_string(), json!(send_id.clone()));`);
          lines.push(`${I}    send_msg.insert("op".to_string(), ${opJson});`);
          lines.push(`${I}    send_msg.insert("to".to_string(), json!(${to}));`);
          if (!isRemoteInst && (positional.length > 0 || named.length > 0)) {
            let bvaJson;
            if (positional.length > 0 && named.length > 0) {
              const posBva = positional.map(a => a.typeName ? `"${a.typeName}"` : 'null').join(', ');
              const namedBva = named.map(a => `"${a.name}": ${a.typeName ? `"${a.typeName}"` : 'null'}`).join(', ');
              bvaJson = `json!([${posBva}, {${namedBva}}])`;
            } else if (named.length > 0) {
              const namedBva = named.map(a => `"${a.name}": ${a.typeName ? `"${a.typeName}"` : 'null'}`).join(', ');
              bvaJson = `json!([{${namedBva}}])`;
            } else {
              const posBva = positional.map(a => a.typeName ? `"${a.typeName}"` : 'null').join(', ');
              bvaJson = `json!([[${posBva}]])`;
            }
            lines.push(`${I}    send_msg.insert("bv-a".to_string(), ${bvaJson});`);
          }
          lines.push(`${I}    let _ = self.binding.send(Value::Object(send_msg));`);
          lines.push(`${I}    send_id`);
          lines.push(`${I}};`);
          lines.push(`${I}let ${tempName} = self.await_response(&${tempName}_id);`);
          // Destructure the response
          for (const item of s.pattern) {
            if (item.discard) continue;
            const key = item.key || item.name;
            const accessor = `${tempName}.get("${key}").cloned().unwrap_or(Value::Null)`;
            if (item.type) {
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else {
              lines.push(`${I}let ${item.name} = ${accessor};`);
            }
          }
          } // close isWrappedChildD else
          } // close isConstructsProxyD else block scope
        }
      } else {
        const srcExpr = genRustExpr(s.source, typeEnv);
        for (const item of s.pattern) {
          if (item.discard) continue;
          const itemType = typeEnv.get(item.name) || null;
          const rType = rustType(itemType);
          if (item.named) {
            const accessor = `${srcExpr}.named.get(${JSON.stringify(item.name)}).cloned().unwrap_or(Value::Null)`;
            lines.push(`${I}let ${item.name}: ${rType} = ${convertFromValue(accessor, itemType)};`);
          } else if (item.key !== undefined) {
            const accessor = `${srcExpr}.named.get(${JSON.stringify(item.key)}).cloned().unwrap_or(Value::Null)`;
            lines.push(`${I}let ${item.name}: ${rType} = ${convertFromValue(accessor, itemType)};`);
          } else if (item.positional) {
            const accessor = `${srcExpr}.positional.get(${item.idx}).cloned().unwrap_or(Value::Null)`;
            lines.push(`${I}let ${item.name}: ${rType} = ${convertFromValue(accessor, itemType)};`);
          }
        }
      }
}

// Handles Assign + FunctionCallExpr variants (actor info, actor fn names, and general fn calls).

function genRustAssignFnCall(s, typeEnv, sCtx, I, lines, fnDefs, body, mutableVars, fns, i) {
      if (s.value.callee?.type === 'Identifier' && G.ctx.actorInfo.has(s.value.callee.name)) {
        // Non-ref actor instantiation — assign actor name string
        const actorName = s.value.callee.name;
        sCtx.childActorRefs.set(s.name, actorName);
        const childActor = G.ctx.actorInfo.get(actorName)?.actor;
        const hasInit = (childActor?.initParams?.length > 0) || (childActor?.initBody?.length > 0) || s.value.args.length > 0 || (childActor?._supertypeBindings?.length > 0);
        if (hasInit) {
          // Unpack named args into positional order matching constructor params
          const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
          let resolvedArgs;
          if (namedBag) {
            const initParams = childActor?.initParams || [];
            const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
            const namedFields = namedBag.fields || {};
            resolvedArgs = [];
            let posIdx = 0;
            for (const p of initParams) {
              const lookupKey = p.key || p.name;
              if (namedFields[lookupKey]) resolvedArgs.push(namedFields[lookupKey]);
              else if (posIdx < positionalArgs.length) resolvedArgs.push(positionalArgs[posIdx++]);
            }
            for (; posIdx < positionalArgs.length; posIdx++) resolvedArgs.push(positionalArgs[posIdx]);
          } else {
            resolvedArgs = s.value.args;
          }
          const initArgs = resolvedArgs.map(a => genRustExpr(a, typeEnv)).join(', ');
          lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&json!([${initArgs}]));`);
        }
        lines.push(`${I}let ${rustIdent(s.name)} = Value::String("${actorName.toLowerCase()}".to_string());`);
      } else if (s.value.callee?.type === 'Identifier' && G.ctx.actorFnNames.has(s.value.callee.name)) {
        const fnDef = fns ? fns.find(f => f.name === s.value.callee.name) : null;
        if (fnDef && fnReturnsFunction(fnDef)) {
          // Inline fn body at call site, tracking returned function
          const fnParams = fnDef.params || [];
          const fnBody = fnDef.body || [];
          const fnReply = fnBody.find(bs => bs.type === 'Reply');
          const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');

          // Bind fn params at current scope
          let pPosIdx = 0;
          for (const pp of fnParams) {
            const arg = pp.positional ? callArgs[pPosIdx++] : null;
            const pt = pp.type || inferLiteralType(arg);
            let argExpr = arg ? genRustExpr(arg, typeEnv) : 'Value::Null';
            if (pt === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
            lines.push(`${I}let ${rustIdent(pp.name)}: ${rustType(pt)} = ${argExpr};`);
          }

          // Process fn body: emit non-function statements, track function literals
          const fnLocalFunctions = new Map();
          for (const bs of fnBody) {
            if (bs.type === 'Reply') continue;
            if ((bs.type === 'Assign' || bs.type === 'TypedAssign') && bs.value.type === 'Function') {
              fnLocalFunctions.set(bs.name, { node: bs.value, defIdx: i });
            } else if (bs.type === 'TypedAssign') {
              let val = genRustExpr(bs.value, typeEnv);
              if (bs.typeName === 'Text' && bs.value.type === 'StringLiteral') val += '.to_string()';
              lines.push(`${I}let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${val};`);
            } else if (bs.type === 'Assign') {
              lines.push(`${I}let ${rustIdent(bs.name)} = ${genRustExpr(bs.value, typeEnv)};`);
            }
          }

          // Find the returned function from Reply and register it under the call-site name
          if (fnReply) {
            const retField = fnReply.fields.find(f =>
              f.type === 'Function' || (typeof f.type === 'string' && f.type?.includes('->')));
            if (retField) {
              const retFunction = fnLocalFunctions.get(retField.name);
              if (retFunction) {
                fnDefs.set(s.name, { node: retFunction.node, defIdx: i });
              }
            }
          }
        } else {
          // Normal function call through Structure
          const knownType = typeEnv.get(s.name);
          if (knownType) {
            const callExpr = genRustFnCallExpr(s.value, typeEnv);
            const converted = convertFromValue(`${callExpr}.one()`, knownType);
            lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(knownType)} = ${converted};`);
          } else {
            lines.push(`${I}let ${rustIdent(s.name)} = ${genRustFnCallExpr(s.value, typeEnv)};`);
          }
        }
      } else {
        // General Assign + FunctionCallExpr (not actor info, not actor fn name)
        const calleeName = s.value.callee?.name;
        const tracked = calleeName ? fnDefs.get(calleeName) : null;
        if (tracked && (tracked.node.returnType === 'Function' || (typeof tracked.node.returnType === 'string' && tracked.node.returnType?.includes('->')))) {
          // Function-returning function: inline body at outer scope, track returned function
          const funcNode = tracked.node;
          const funcParams = funcNode.params || [];
          const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
          const funcBody = funcNode.body || [];

          // Bind function params at current scope
          let posIdx = 0;
          for (const param of funcParams) {
            const arg = param.positional ? callArgs[posIdx++] : null;
            const pt = param.type || inferLiteralType(arg);
            let argExpr = arg ? genRustExpr(arg, typeEnv) : 'Value::Null';
            if (pt === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
            lines.push(`${I}let ${rustIdent(param.name)}: ${rustType(pt)} = ${argExpr};`);
          }

          // Process body: emit non-function statements, track function literals
          const localFnDefs = new Map();
          for (const bs of funcBody) {
            if (bs.type === 'ImplicitReturn') continue;
            if ((bs.type === 'Assign' || bs.type === 'TypedAssign') && bs.value.type === 'Function') {
              localFnDefs.set(bs.name, { node: bs.value, defIdx: i });
            } else if (bs.type === 'TypedAssign') {
              let val = genRustExpr(bs.value, typeEnv);
              if (bs.typeName === 'Text' && bs.value.type === 'StringLiteral') val += '.to_string()';
              lines.push(`${I}let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${val};`);
            } else if (bs.type === 'Assign') {
              lines.push(`${I}let ${rustIdent(bs.name)} = ${genRustExpr(bs.value, typeEnv)};`);
            }
          }

          // Find returned function from ImplicitReturn
          const implRet = funcBody.find(bs => bs.type === 'ImplicitReturn');
          if (implRet && implRet.expr?.type === 'Identifier') {
            const retFunction = localFnDefs.get(implRet.expr.name);
            if (retFunction) {
              fnDefs.set(s.name, { node: retFunction.node, defIdx: i });
            }
          }
        } else {
          // Normal function call in Assign
          const knownType = typeEnv.get(s.name);
          if (knownType) {
            let val = genRustExpr(s.value, typeEnv);
            if (knownType === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
            if (knownType && knownType.includes?.('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `json!(${val})`;
            lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(knownType)} = ${val};`);
          } else {
            lines.push(`${I}let ${rustIdent(s.name)}: Value = ${genRustExpr(s.value, typeEnv)};`);
          }
        }
      }
}

// Handles Assign/TypedAssign + DotCallExpr on child actors.

function genRustAssignChildDotCall(s, typeEnv, sCtx, I, lines) {
      const expr = s.value;
      let actorName;
      if (expr.object.type === 'RefRead' || expr.object.type === 'Identifier') {
        actorName = sCtx.childActorRefs.get(expr.object.name);
      } else {
        actorName = expr.object.callee.name;
        {
          const childActorObj = G.ctx.actorInfo.get(actorName)?.actor;
          if (expr.object.args.length > 0 || childActorObj?._supertypeBindings?.length > 0) {
            const initArgs = expr.object.args.map(a => genRustExpr(a, typeEnv)).join(', ');
            lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&json!([${initArgs}]));`);
          }
        }
      }
      const method = JSON.stringify('@' + expr.method);
      const positional = expr.args.filter(a => a.positional);
      const named = expr.args.filter(a => !a.positional);
      let payload;
      if (positional.length > 0 && named.length > 0) {
        const posVals = positional.map(a => genRustExpr(a.expr, typeEnv)).join(', ');
        const namedEntries = named.map(a => `"${a.name}": ${genRustExpr(a.expr || { type: 'Identifier', name: a.name }, typeEnv)}`).join(', ');
        payload = `json!([${posVals}, {${namedEntries}}])`;
      } else if (positional.length > 0) {
        const posVals = positional.map(a => genRustExpr(a.expr, typeEnv)).join(', ');
        payload = `json!([${posVals}])`;
      } else if (named.length > 0) {
        const namedEntries = named.map(a => `"${a.name}": ${genRustExpr(a.expr || { type: 'Identifier', name: a.name }, typeEnv)}`).join(', ');
        payload = `json!({${namedEntries}})`;
      } else {
        payload = 'json!({})';
      }
      const childCall = `self.child_${actorName.toLowerCase()}_dispatch(${method}, &${payload})`;
      const knownType = typeEnv.get(s.name);
      if (knownType) {
        // Extract single value: child dispatch returns a json object, use Structure to extract the one value
        const accessor = `{ let _cr = ${childCall}; let _cs = Structure::pack(&_cr); _cs.one() }`;
        lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(knownType)} = ${convertFromValue(accessor, knownType)};`);
      } else {
        // Untyped: extract single positional value
        lines.push(`${I}let ${rustIdent(s.name)} = { let _cr = ${childCall}; let _cs = Structure::pack(&_cr); _cs.one() };`);
      }
}

// Handles Assign/TypedAssign + DotCallExpr on remote instances or constructs proxies.

function genRustAssignRemoteDotCall(s, typeEnv, I, lines) {
      const expr = s.value;
      const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : expr.object.name;
      const isProxy = G.ctx.constructsProxyVars.has(dotObjName);
      const knownType = typeEnv.get(s.name);
      if (isProxy) {
        const proxyName = G.ctx.constructsVarToProxy.get(dotObjName);
        const method = JSON.stringify('@' + expr.method);
        const payload = 'json!({})';
        const childCall = `self.child_dispatch("${proxyName}", ${method}, &${payload})`;
        const accessor = `{ let _cr = ${childCall}; _cr.get("${s.name}").cloned().unwrap_or_else(|| { let _cs = Structure::pack(&_cr); _cs.one() }) }`;
        if (knownType) {
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(knownType)} = ${convertFromValue(accessor, knownType)};`);
        } else {
          lines.push(`${I}let ${rustIdent(s.name)} = ${accessor};`);
        }
      } else {
        // Remote instance: send + await_response
        const to = `self.state.get("${dotObjName}").and_then(|v| v.as_str()).unwrap_or("").to_string()`;
        const method = JSON.stringify(expr.method);
        const opJson = `json!(${method})`;
        lines.push(`${I}let _await_id = {`);
        lines.push(`${I}    let seq = self.send_seq.get();`);
        lines.push(`${I}    self.send_seq.set(seq + 1);`);
        lines.push(`${I}    let send_id = seq.to_string();`);
        lines.push(`${I}    let mut send_msg = Map::new();`);
        lines.push(`${I}    send_msg.insert("id".to_string(), json!(send_id.clone()));`);
        lines.push(`${I}    send_msg.insert("op".to_string(), ${opJson});`);
        lines.push(`${I}    send_msg.insert("to".to_string(), json!(${to}));`);
        lines.push(`${I}    let _ = self.binding.send(Value::Object(send_msg));`);
        lines.push(`${I}    send_id`);
        lines.push(`${I}};`);
        lines.push(`${I}let _await_re = self.await_response(&_await_id);`);
        const accessor = `_await_re.get("${s.name}").cloned().unwrap_or(Value::Null)`;
        if (knownType) {
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(knownType)} = ${convertFromValue(accessor, knownType)};`);
        } else {
          lines.push(`${I}let ${rustIdent(s.name)} = ${accessor};`);
        }
      }
}

// --- End of extracted helper functions ---

function genRustLocals(body, typeEnv, functionAnalysis, mutableVars, indent, fns) {
  const { fnDefs, skipSet, capturePoints } = functionAnalysis;
  const sCtx = { childActorRefs: new Map() };
  const lines = [];
  const I = indent || '                ';

  for (let i = 0; i < body.length; i++) {
    const s = body[i];

    // Emit capture points for fnDefs defined at this index
    if (capturePoints.has(i)) {
      for (const cp of capturePoints.get(i)) {
        lines.push(`${I}let ${cp.capName}: ${cp.rustType} = ${cp.varName};`);
      }
    }

    // Skip statements that are part of the function pipeline
    // But emit recursive fnDefs as actual Rust functions
    if (skipSet.has(i)) {
      if (s.type === 'Assign' || s.type === 'TypedAssign') {
        const tracked = fnDefs.get(s.name);
        if (tracked && tracked.recursive) {
          lines.push(`${I}${genRecursiveFnDef(s.name, tracked.node, typeEnv).split('\n').join('\n' + I)}`);
        } else if (tracked && s.value.type === 'Function') {
          // Only convert to handler if the lambda escapes its scope (returned as a value)
          // Otherwise it will be inlined at call sites by the function pipeline
          const isReturned = body.some(bs => bs.type === 'Reply' && bs.fields.some(f =>
            (f.name === s.name) || (f.expr?.type === 'Identifier' && f.expr.name === s.name),
          ));
          if (isReturned) {
            // Register lambda as a dispatch handler with captured variables
            const lambdaName = `_lambda_${G.ctx.lambdaCounter++}`;
            const fnNode = tracked.node;
            // Find free variables (identifiers used but not defined as params or locals)
            const freeVars = [];
            const paramNames = new Set((fnNode.params || []).map(p => p.name));
            // Collect variables assigned inside the lambda body — these are locals, not captures
            const bodyLocals = new Set();
            if (fnNode.body) for (const bs of fnNode.body) {
              if (bs.type === 'TypedAssign' || bs.type === 'Assign') bodyLocals.add(bs.name);
            }
            const localScope = new Set([...paramNames, ...bodyLocals]);
            function walkForIdents(expr) {
              if (!expr) return;
              if (expr.type === 'Identifier' && !localScope.has(expr.name)) freeVars.push(expr.name);
              if (expr.type === 'BinaryExpr') { walkForIdents(expr.left); walkForIdents(expr.right); }
              if (expr.type === 'FunctionCallExpr') {
                if (expr.callee) walkForIdents(expr.callee);
                for (const a of (expr.args || [])) walkForIdents(a);
              }
            }
            if (fnNode.body) for (const bs of fnNode.body) {
              if (bs.type === 'ImplicitReturn') walkForIdents(bs.expr);
              if (bs.type === 'TypedAssign' || bs.type === 'Assign') walkForIdents(bs.value);
              if (bs.expr) walkForIdents(bs.expr);
            }
            if (fnNode.expr) walkForIdents(fnNode.expr);
            // Deduplicate and filter out actor function names (those are self-sends, not captures)
            const uniqueFreeVars = [...new Set(freeVars)].filter(v => !G.ctx.actorFnNames.has(v));
            // Store captures in actor state
            for (const v of uniqueFreeVars) {
              lines.push(`${I}self.state.insert("_cap_${lambdaName}_${v}".to_string(), json!(${rustIdent(v)}));`);
            }
            G.ctx.lambdaHandlers.push({ name: lambdaName, fn: fnNode, captures: uniqueFreeVars.map(v => ({ name: v, lambdaName })) });
            G.ctx.lambdaVarNames.add(s.name);
            lines.push(`${I}let ${rustIdent(s.name)} = Value::String("${lambdaName}".to_string());`);
          }
        }
      }
      continue;
    }

    if (s.type === 'TypedAssign') {
      if (genRustTypedAssign(s, typeEnv, fnDefs, sCtx, I, lines, i, body, mutableVars, fns, functionAnalysis)) continue;
    } else if (s.type === 'DestructureAssign') {
      genRustDestructureAssign(s, typeEnv, sCtx, I, lines, i, fnDefs);
    } else if (s.type === 'Assign' && s.value.type === 'FunctionCallExpr') {
      genRustAssignFnCall(s, typeEnv, sCtx, I, lines, fnDefs, body, mutableVars, fns, i);
    } else if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'DotCallExpr' && (
      (s.value.object.type === 'FunctionCallExpr' && s.value.object.callee?.type === 'Identifier' && G.ctx.actorInfo.has(s.value.object.callee.name)) ||
      (s.value.object.type === 'RefRead' && sCtx.childActorRefs.has(s.value.object.name)) ||
      (s.value.object.type === 'Identifier' && sCtx.childActorRefs.has(s.value.object.name))
    )) {
      genRustAssignChildDotCall(s, typeEnv, sCtx, I, lines);
    } else if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'DotCallExpr' && (() => {
      const dotObj = s.value.object;
      const dn = dotObj.type === 'RefRead' ? dotObj.name : (dotObj.type === 'Identifier' ? dotObj.name : null);
      const match = dn && (G.ctx.remoteInstanceVars.has(dn) || G.ctx.constructsProxyVars.has(dn));
      return match;
    })()) {
      genRustAssignRemoteDotCall(s, typeEnv, I, lines);
    } else if (s.type === 'Assign') {
      const isStructLiteral = s.value.type === 'StructureLiteral' || s.value.type === 'StructureConstructor';
      if (isStructLiteral) {
        lines.push(`${I}let ${rustIdent(s.name)} = ${genRustExpr(s.value, typeEnv)};`);
      } else {
        // Use known type from typeEnv for proper Rust type
        const knownType = typeEnv.get(s.name);
        if (knownType) {
          let val = genRustExpr(s.value, typeEnv);
          if (knownType === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
          if (knownType && knownType.includes?.('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `json!(${val})`;
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(knownType)} = ${val};`);
        } else {
          lines.push(`${I}let ${rustIdent(s.name)}: Value = ${genRustExpr(s.value, typeEnv)};`);
        }
      }
    } else if (s.type === 'StateAssign') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
      lines.push(`${I}self.state.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'WhileStatement') {
      lines.push(genRustWhileStatement(s, typeEnv, I));
    } else if (s.type === 'RefDecl') {
      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && G.ctx.actorInfo.has(s.value.callee.name)) {
        // Child actor ref — track mapping, call init if needed
        sCtx.childActorRefs.set(s.name, s.value.callee.name);
        const actorName = s.value.callee.name;
        {
          const childActorObj = G.ctx.actorInfo.get(actorName)?.actor;
          if (s.value.args.length > 0 || childActorObj?._supertypeBindings?.length > 0) {
            const initArgs = s.value.args.map(a => genRustExpr(a, typeEnv)).join(', ');
            lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&json!([${initArgs}]));`);
          }
        }
      } else {
        const val = s.value ? genRustExpr(s.value, typeEnv) : 'Value::Null';
        const t = s.typeName || inferLiteralType(s.value);
        lines.push(`${I}${rsStore(s.name)}.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
      }
    } else if (s.type === 'SetStatement') {
      if (sCtx.childActorRefs && sCtx.childActorRefs.has(s.name)) {
        const actorName = sCtx.childActorRefs.get(s.name);
        const wireOp = s.updateOp === '<|' ? '::update' : '::set';
        const val = genRustExpr(s.value, typeEnv);
        lines.push(`${I}self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &json!([${val}]));`);
      } else if (s.value?.type === 'Function') {
        // Lambda assignment to state/ref var — register handler, store label
        const lambdaName = `_lambda_${G.ctx.lambdaCounter++}`;
        G.ctx.lambdaHandlers.push({ name: lambdaName, fn: s.value });
        lines.push(`${I}${rsStore(s.name)}.insert("${stateKey(s.name)}".to_string(), json!("${lambdaName}"));`);
      } else {
        const val = genRustExpr(s.value, typeEnv);
        const t = typeEnv.get(s.name) || inferLiteralType(s.value);
        lines.push(`${I}${rsStore(s.name)}.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
      }
    } else if (s.type === 'ActorSetStatement') {
      if (sCtx.childActorRefs && sCtx.childActorRefs.has(s.name)) {
        const actorName = sCtx.childActorRefs.get(s.name);
        const wireOp = s.updateOp === '<|' ? '::update' : '::set';
        const posArgs = s.args.filter(a => a.positional).map(a => genRustExpr(a.expr, typeEnv));
        const namedArgs = s.args.filter(a => !a.positional);
        let payload;
        if (namedArgs.length > 0) {
          const namedObj = namedArgs.map(a => `"${a.name}": ${genRustExpr(a.expr, typeEnv)}`).join(', ');
          if (posArgs.length > 0) {
            payload = `[${posArgs.join(', ')}, {${namedObj}}]`;
          } else {
            payload = `{${namedObj}}`;
          }
        } else {
          payload = `[${posArgs.join(', ')}]`;
        }
        lines.push(`${I}self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &json!(${payload}));`);
      }
    } else if (s.type === 'ListDestructure') {
      lines.push(genRustListDestructure(s, typeEnv, I));
    } else if (s.type === 'IfStatement') {
      const cond = genRustCondition(s.cond, typeEnv);
      const bodyLines = [];
      for (const bs of s.body) {
        if (bs.type === 'SetStatement') {
          if (sCtx.childActorRefs && sCtx.childActorRefs.has(bs.name)) {
            const actorName = sCtx.childActorRefs.get(bs.name);
            const wireOp = bs.updateOp === '<|' ? '::update' : '::set';
            const val = genRustExpr(bs.value, typeEnv);
            bodyLines.push(`${I}    self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &json!([${val}]));`);
          } else {
            const val = genRustExpr(bs.value, typeEnv);
            const t = typeEnv.get(bs.name) || inferLiteralType(bs.value);
            bodyLines.push(`${I}    ${rsStore(bs.name)}.insert("${stateKey(bs.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
          }
        } else if (bs.type === 'StateAssign') {
          const val = genRustExpr(bs.value, typeEnv);
          const t = typeEnv.get('$' + bs.name) || inferLiteralType(bs.value);
          bodyLines.push(`${I}    self.state.insert("${stateKey(bs.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
        } else if (bs.type === 'ExprStatement') {
          bodyLines.push(`${I}    ${genRustExpr(bs.expr, typeEnv)};`);
        }
      }
      lines.push(`${I}if ${cond} {\n${bodyLines.join('\n')}\n${I}}`);
    } else if (s.type === 'SpawnStatement') {
      if (s.call.type === 'FunctionCallExpr' && s.call.callee?.type === 'Identifier' && G.ctx.actorFnNames.has(s.call.callee.name)) {
        const callExpr = genRustFnCallExpr(s.call, typeEnv);
        lines.push(`${I}let _ = ${callExpr};`);
      } else if (s.call.type === 'DotCallExpr') {
        lines.push(`${I}${genRustExpr(s.call, typeEnv)};`);
      }
    } else if (s.type === 'ExprStatement') {
      if (s.expr.type === 'DotCallExpr' && (() => {
        const dotObjName = s.expr.object.type === 'RefRead' ? s.expr.object.name : (s.expr.object.type === 'Identifier' ? s.expr.object.name : null);
        return dotObjName && sCtx.childActorRefs.has(dotObjName);
      })()) {
        // Fire-and-forget DotCallExpr on local child actor
        const expr = s.expr;
        const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : expr.object.name;
        const actorName = sCtx.childActorRefs.get(dotObjName);
        const method = JSON.stringify('@' + expr.method);
        const positional = expr.args.filter(a => a.positional);
        const named = expr.args.filter(a => !a.positional);
        let payload;
        if (positional.length > 0 && named.length > 0) {
          const posVals = positional.map(a => genRustExpr(a.expr, typeEnv)).join(', ');
          const namedEntries = named.map(a => `"${a.name}": ${genRustExpr(a.expr || { type: 'Identifier', name: a.name }, typeEnv)}`).join(', ');
          payload = `json!([${posVals}, {${namedEntries}}])`;
        } else if (positional.length > 0) {
          const posVals = positional.map(a => genRustExpr(a.expr, typeEnv)).join(', ');
          payload = `json!([${posVals}])`;
        } else if (named.length > 0) {
          const namedEntries = named.map(a => `"${a.name}": ${genRustExpr(a.expr || { type: 'Identifier', name: a.name }, typeEnv)}`).join(', ');
          payload = `json!({${namedEntries}})`;
        } else {
          payload = 'json!({})';
        }
        lines.push(`${I}self.child_${actorName.toLowerCase()}_dispatch(${method}, &${payload});`);
      } else if (s.expr.type === 'IfExpr') {
        lines.push(genRustIfStatement(s.expr, typeEnv, I));
      } else if (s.expr.type === 'FunctionCallExpr') {
        // Inline function for side effects
        const calleeName = s.expr.callee?.name;
        const tracked = calleeName ? fnDefs.get(calleeName) : null;
        if (tracked) {
          const funcNode = tracked.node;
          const funcParams = funcNode.params || [];
          const callArgs = s.expr.args.filter(a => a.type !== 'NamedArgsBag');
          const namedArgsBagE = s.expr.args.find(a => a.type === 'NamedArgsBag');
          const fnBodyStmts = funcNode.body ? funcNode.body.filter(st => st.type !== 'ImplicitReturn' && st.type !== 'Return') : [];
          const blockLines = [];
          // Build ref param mapping: param.name → original ref name
          const refParamMap = new Map();
          let posIdxE = 0;
          for (let pi = 0; pi < funcParams.length; pi++) {
            const param = funcParams[pi];
            let arg;
            const lookupKey = param.key || param.name;
            if (param.positional) {
              arg = callArgs[posIdxE++];
            } else if (namedArgsBagE && namedArgsBagE.fields && lookupKey in namedArgsBagE.fields) {
              arg = namedArgsBagE.fields[lookupKey];
            }
            if (param.ref && arg?.type === 'RefArg') {
              refParamMap.set(param.name, arg.name);
              // Emit a read binding so the param name is available in body expressions
              const refReadExpr = `${rsStore(arg.name)}.get("${arg.name}").cloned().unwrap_or(Value::Null)`;
              if (param.type) {
                blockLines.push(`${I}let ${rustIdent(param.name)}: ${rustType(param.type)} = ${convertFromValue(refReadExpr, param.type)};`);
              } else {
                blockLines.push(`${I}let ${rustIdent(param.name)} = ${refReadExpr};`);
              }
              continue;
            }
            const paramType = param.type || inferLiteralType(arg) || (arg?.type === 'Identifier' ? typeEnv.get(arg.name) : null);
            let argExpr = arg ? genRustExpr(arg, typeEnv) : 'Value::Null';
            if (paramType) {
              if (paramType === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
              blockLines.push(`${I}let ${param.name}: ${rustType(paramType)} = ${argExpr};`);
            } else {
              blockLines.push(`${I}let ${param.name} = ${argExpr};`);
            }
          }
          // Rewrite RefRead nodes in expressions that refer to ref params → use local let binding
          function rewriteRefReads(node) {
            if (!node || typeof node !== 'object') return node;
            if (node.type === 'RefRead' && refParamMap.has(node.name)) {
              return { type: 'Identifier', name: node.name };
            }
            const copy = Array.isArray(node) ? [...node] : { ...node };
            for (const key of Object.keys(copy)) {
              if (key === 'type') continue;
              copy[key] = rewriteRefReads(copy[key]);
            }
            return copy;
          }
          for (const bs of fnBodyStmts) {
            if (bs.type === 'SetStatement') {
              if (sCtx.childActorRefs && sCtx.childActorRefs.has(bs.name)) {
                const actorName = sCtx.childActorRefs.get(bs.name);
                const wireOp = bs.updateOp === '<|' ? '::update' : '::set';
                const rewritten = rewriteRefReads(bs.value);
                const bsVal = genRustExpr(rewritten, typeEnv);
                blockLines.push(`${I}self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &json!([${bsVal}]));`);
              } else {
                const refName = refParamMap.get(bs.name) || bs.name;
                const rewritten = rewriteRefReads(bs.value);
                const bsVal = genRustExpr(rewritten, typeEnv);
                const t = typeEnv.get(refName) || typeEnv.get(bs.name) || inferLiteralType(bs.value);
                blockLines.push(`${I}${rsStore(refName)}.insert("${refName}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
              }
            } else if (bs.type === 'StateAssign') {
              const bsVal = genRustExpr(bs.value, typeEnv);
              const t = typeEnv.get('$' + bs.name) || inferLiteralType(bs.value);
              blockLines.push(`${I}self.state.insert("${stateKey(bs.name)}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
            } else if (bs.type === 'ExprStatement') {
              blockLines.push(`${I}${genRustExpr(bs.expr, typeEnv)};`);
            }
          }
          if (blockLines.length > 0) lines.push(blockLines.join('\n'));
        } else {
          lines.push(`${I}${genRustExpr(s.expr, typeEnv)};`);
        }
      } else {
        lines.push(`${I}${genRustExpr(s.expr, typeEnv)};`);
      }
    }
  }
  return lines.join('\n');
}

function genRustWhileStatement(node, typeEnv, I) {
  const lines = [];
  const cond = genRustCondition(node.cond, typeEnv);
  const whileCond = node.negated ? `!(${cond})` : cond;
  lines.push(`${I}loop {`);
  lines.push(`${I}    if !(${whileCond}) { break; }`);
  for (const s of node.body) {
    if (s.type === 'StateAssign') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
      lines.push(`${I}    self.state.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'SetStatement') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get(s.name) || inferLiteralType(s.value);
      lines.push(`${I}    ${rsStore(s.name)}.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'TypedAssign') {
      let val = genRustExpr(s.value, typeEnv);
      if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
      lines.push(`${I}    let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
    } else if (s.type === 'Assign') {
      lines.push(`${I}    let ${rustIdent(s.name)} = ${genRustExpr(s.value, typeEnv)};`);
    } else if (s.type === 'ExprStatement') {
      lines.push(`${I}    ${genRustExpr(s.expr, typeEnv)};`);
    }
  }
  lines.push(`${I}}`);
  return lines.join('\n');
}

function genRustListDestructure(node, typeEnv, I) {
  const lines = [];
  const src = genRustExpr(node.source, typeEnv);
  const tempBase = `_ld${G.ctx.fnTempCounter++}`;
  lines.push(`${I}let ${tempBase} = ${src};`);

  const pattern = node.pattern;
  const hasRest = pattern.some(p => p.rest);
  let cur = tempBase;

  for (let i = 0; i < pattern.length; i++) {
    const item = pattern[i];
    if (item.rest) {
      // Rest: take remaining as array (or null if empty)
      if (!item.discard && item.name) {
        const rType = rustType(item.type);
        lines.push(`${I}let ${item.name}: ${rType} = ${cur};`);
      }
      break;
    }
    // Extract head — panic if list is empty
    lines.push(`${I}if ${cur}.as_array().map(|a| a.is_empty()).unwrap_or(true) { panic!("list_destructure_empty"); }`);
    if (!item.discard && item.name) {
      const accessor = `${cur}.as_array().and_then(|a| a.first()).cloned().unwrap_or(Value::Null)`;
      lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
    }
    // Advance to tail
    if (i < pattern.length - 1) {
      const next = `${tempBase}_${i}`;
      lines.push(`${I}let ${next}: Value = ${cur}.as_array().map(|a| if a.len() > 1 { json!(&a[1..]) } else { Value::Null }).unwrap_or(Value::Null);`);
      cur = next;
    }
  }

  // Arity check: if no rest and more than one element, check tail is empty
  if (!hasRest && pattern.length > 0) {
    lines.push(`${I}if ${cur}.as_array().map(|a| a.len()).unwrap_or(0) > 1 { panic!("list_destructure_arity"); }`);
  }

  return lines.join('\n');
}

function genRustIfStatementBody(branch, typeEnv, I) {
  const lines = [];
  const stmts = branch.body || (branch.expr ? [{ type: 'ExprStatement', expr: branch.expr }] : []);
  for (const s of stmts) {
    if (s.type === 'SetStatement') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get(s.name) || inferLiteralType(s.value);
      lines.push(`${I}${rsStore(s.name)}.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'StateAssign') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
      lines.push(`${I}self.state.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'ExprStatement') {
      if (s.expr.type === 'IfExpr') {
        lines.push(genRustIfStatement(s.expr, typeEnv, I));
      } else {
        lines.push(`${I}${genRustExpr(s.expr, typeEnv)};`);
      }
    } else if (s.type === 'TypedAssign') {
      let val = genRustExpr(s.value, typeEnv);
      if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
      lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
    } else if (s.type === 'Assign') {
      lines.push(`${I}let ${rustIdent(s.name)} = ${genRustExpr(s.value, typeEnv)};`);
    }
  }
  return lines.join('\n');
}

function genRustIfStatement(expr, typeEnv, I) {
  const cond = genRustCondition(expr.cond, typeEnv);
  const thenBody = genRustIfStatementBody(expr.then, typeEnv, `${I}    `);
  let code = `${I}if ${cond} {\n${thenBody}\n${I}}`;
  if (expr.else) {
    if (expr.else.type === 'IfExpr') {
      code += ` else ` + genRustIfStatement(expr.else, typeEnv, I).trimStart();
    } else {
      const elseBody = genRustIfStatementBody(expr.else, typeEnv, `${I}    `);
      code += ` else {\n${elseBody}\n${I}}`;
    }
  }
  return code;
}

function genRustReBody(fields, typeEnv, refNames) {
  refNames = refNames || new Set();
  const spread = fields.find(f => f.spread);
  if (spread) return `${spread.name}.splat()`;

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  function resolveFieldName(name) {
    if (name.startsWith('$')) return resolveVarExpr(name);
    if (G.ctx.stateVarNames.has(name)) return `self.state.get("${stateKey(name)}").cloned().unwrap_or(Value::Null)`;
    if (refNames.has(name)) return `self.refs.get("${name}").cloned().unwrap_or(Value::Null)`;
    return null;
  }

  function reFieldVal(f) {
    if (f.name) {
      const resolved = resolveFieldName(f.name);
      if (resolved) return resolved;
      const t = f.type || typeEnv.get(f.name);
      return toJsonValue(rustIdent(f.name), t);
    }
    if (f._precomputed) return f._precomputed;
    if (f.expr) return toJsonValue(genRustExpr(f.expr, typeEnv), null);
    return 'Value::Null';
  }

  if (pos.length > 0 && named.length > 0) {
    // Mixed: [pos1, pos2, {key: val}]
    const posVals = pos.map(reFieldVal).join(', ');
    const namedEntries = named.map(f => {
      if ('sigil' in f) return `"${f.sigil}": ${resolveFieldName(f.sigil) || (typeEnv.has(f.sigil) ? f.sigil : JSON.stringify(f.sigil))}`;
      if (f.key !== undefined) return `"${f.key}": ${genRustExpr(f.value, typeEnv)}`;
      return '';
    }).filter(Boolean).join(', ');
    return `json!([${posVals}, {${namedEntries}}])`;
  } else if (pos.length > 0) {
    // Positional only: [val1, val2]
    const posVals = pos.map(reFieldVal).join(', ');
    return `json!([${posVals}])`;
  } else {
    // Named only: {key: val}
    const entries = [];
    for (const f of named) {
      if ('sigil' in f) {
        entries.push(`"${f.sigil}": ${resolveFieldName(f.sigil) || (typeEnv.has(f.sigil) ? f.sigil : JSON.stringify(f.sigil))}`);
      } else if (f.key !== undefined) {
        entries.push(`"${f.key}": ${genRustExpr(f.value, typeEnv)}`);
      }
    }
    return `json!({${entries.join(', ')}})`;
  }
}

function genRustBvaBody(fields, typeEnv, refNames) {
  const spread = fields.find(f => f.spread);
  if (spread) return null; // bv-a handled separately for spread

  const isListOfAny = t => t === 'List of Anything' || t === 'List';

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  let hasDynamic = false;

  // Collect types for positional fields
  const posTypes = [];
  for (const f of pos) {
    const t = f.type || (f.name ? typeEnv.get(f.name) : null) || inferLiteralType(f.expr);
    if (!t) return null;
    if (isListOfAny(t)) {
      hasDynamic = true;
      const varName = f.name || (f.expr?.type === 'Identifier' ? f.expr.name : null);
      if (!varName) return null;
      posTypes.push({ dynamic: true, expr: `list_types_of(&${varName})` });
    } else {
      posTypes.push({ dynamic: false, val: JSON.stringify(t) });
    }
  }

  // Collect types for named fields
  const namedTypes = [];
  for (const f of named) {
    let key, t, varName;
    if ('sigil' in f) {
      key = f.sigil;
      t = f.type || typeEnv.get(f.sigil);
      varName = f.sigil;
    } else if (f.key !== undefined) {
      key = f.key;
      t = f.type || (f.value?.type === 'Identifier' || f.value?.type === 'RefRead' ? typeEnv.get(f.value.name) : null) || (f.value?.type === 'StateVar' ? typeEnv.get('$' + f.value.name) : null) || inferLiteralType(f.value);
      varName = (f.value?.type === 'Identifier' || f.value?.type === 'RefRead') ? f.value.name : null;
    }
    if (!key || !t) return null;
    if (isListOfAny(t)) {
      hasDynamic = true;
      if (!varName) return null;
      const resolved = G.ctx.stateVarNames.has(varName) ? `self.state.get("${varName}").cloned().unwrap_or(Value::Null)` : (refNames.has(varName) ? `self.refs.get("${varName}").cloned().unwrap_or(Value::Null)` : varName);
      namedTypes.push({ dynamic: true, key, expr: `list_types_of(&${resolved})` });
    } else {
      namedTypes.push({ dynamic: false, key, val: `"${t}"` });
    }
  }

  if (!hasDynamic) {
    // Static bv-a — use json! macro
    if (pos.length > 0 && named.length > 0) {
      return `json!([${posTypes.map(p => p.val).join(', ')}, {${namedTypes.map(n => `"${n.key}": ${n.val}`).join(', ')}}])`;
    } else if (pos.length > 0) {
      return `json!([${posTypes.map(p => p.val).join(', ')}])`;
    } else if (named.length > 0) {
      return `json!({${namedTypes.map(n => `"${n.key}": ${n.val}`).join(', ')}})`;
    }
    return null;
  }

  // Dynamic bv-a — build at runtime with Map
  if (named.length > 0 && pos.length === 0) {
    const pairs = namedTypes.map(n => {
      if (n.dynamic) {
        return `bva_map.insert("${n.key}".to_string(), ${n.expr});`;
      } else {
        return `bva_map.insert("${n.key}".to_string(), json!(${n.val}));`;
      }
    });
    return `{ let mut bva_map = Map::new(); ${pairs.join(' ')} Value::Object(bva_map) }`;
  }
  // For now, return null for complex dynamic cases (pos + named with dynamic)
  return null;
}

export { genRustTypedAssign, genRustDestructureAssign, genRustAssignFnCall, genRustAssignChildDotCall, genRustAssignRemoteDotCall, genRustLocals, genRustWhileStatement, genRustListDestructure, genRustIfStatementBody, genRustIfStatement, genRustReBody, genRustBvaBody };
