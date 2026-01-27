import React, { useState, useEffect } from 'react';
import './KnowledgeBase.css';

function KnowledgeBase({ serviceName, onClose }) {
  const [serviceData, setServiceData] = useState(null);
  const [functionalData, setFunctionalData] = useState(null);
  const [aiData, setAiData] = useState(null);
  const [testData, setTestData] = useState(null);
  const [sequenceData, setSequenceData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [generatingDescriptions, setGeneratingDescriptions] = useState({});

  useEffect(() => {
    loadServiceDocs();
  }, [serviceName]);

  const [graphqlData, setGraphqlData] = useState(null);
  const [descriptionCache, setDescriptionCache] = useState({});

  const generateAISection = async (sectionType) => {
    const key = `ai-section:${sectionType}`;
    setGeneratingDescriptions(prev => ({ ...prev, [key]: true }));

    try {
      const response = await fetch(`/api/knowledge-base/service/${serviceName}/generate-ai-section`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionType,
          serviceData: {
            name: serviceName,
            totalMethods: serviceData?.services?.length || 0,
            totalEntities: serviceData?.entities?.length || 0,
            totalQueries: graphqlData?.queries?.length || 0,
            totalMutations: graphqlData?.mutations?.length || 0
          },
          functionalData: {
            purpose: functionalData?.purpose,
            keyFeatures: functionalData?.key_features?.slice(0, 5),
            businessCapabilities: functionalData?.business_capabilities?.slice(0, 10),
            workflows: functionalData?.workflows,
            businessRules: functionalData?.business_rules?.slice(0, 8)
          }
        })
      });

      const result = await response.json();

      if (result.success) {
        console.log(`✓ Generated ${sectionType}:`, result.description.substring(0, 100));
        setDescriptionCache(prev => ({ ...prev, [key]: result.description }));
      }
    } catch (error) {
      console.error('Error generating AI section:', error);
      alert('Failed to generate AI section. Check console for details.');
    } finally {
      setGeneratingDescriptions(prev => ({ ...prev, [key]: false }));
    }
  };

  const generateDescription = async (type, item, context = {}) => {
    // Create consistent key format
    let key;
    if (type === 'service-method') {
      key = `${type}:${item.class_name}.${item.name}`;
    } else {
      key = `${type}:${item.name || item.domain}`;
    }
    setGeneratingDescriptions(prev => ({ ...prev, [key]: true }));

    try {
      const requestBody = {
        type,
        name: item.name || item.domain,
        context
      };

      // Add type-specific fields
      if (type === 'query' || type === 'mutation') {
        requestBody.signature = item.name;
        requestBody.returnType = item.return_type;
        requestBody.arguments = item.arguments || [];
      } else if (type === 'feature-domain') {
        requestBody.context = {
          capabilities: item.capabilities,
          servicePurpose: functionalData?.purpose
        };
      } else if (type === 'service-method') {
        requestBody.returnType = item.return_type;
        requestBody.context = {
          className: item.class_name,
          parameters: item.parameters,
          relatedMethods: context.relatedMethods || []
        };
      }

      const response = await fetch(`/api/knowledge-base/service/${serviceName}/generate-description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();

      if (result.success) {
        console.log('✓ Generated description:', {
          type,
          name: item.name || item.domain,
          key,
          cacheKey: result.cacheKey,
          descriptionLength: result.description.length
        });

        // Update cache
        setDescriptionCache(prev => {
          const updated = { ...prev, [key]: result.description };
          console.log('Updated cache:', Object.keys(updated));
          return updated;
        });

        // Update specific data structure
        if (type === 'query' || type === 'mutation') {
          setGraphqlData(prev => {
            const updated = { ...prev };
            const items = type === 'query' ? updated.queries : updated.mutations;
            const itemIndex = items.findIndex(i => i.name === item.name);
            if (itemIndex !== -1) {
              items[itemIndex] = { ...items[itemIndex], description: result.description };
            }
            return updated;
          });
        }
      }
    } catch (error) {
      console.error('Error generating description:', error);
      alert('Failed to generate description. Check console for details.');
    } finally {
      setGeneratingDescriptions(prev => ({ ...prev, [key]: false }));
    }
  };

  const loadServiceDocs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/knowledge-base/service/${serviceName}`);
      if (!res.ok) throw new Error('Documentation not found');
      const data = await res.json();
      setServiceData(data);

      // Load GraphQL documentation
      const graphqlRes = await fetch(`/api/knowledge-base/service/${serviceName}/graphql`);
      if (graphqlRes.ok) {
        const graphql = await graphqlRes.json();
        setGraphqlData(graphql);
      }

      // Load functional documentation
      const funcRes = await fetch(`/api/knowledge-base/service/${serviceName}/functional`);
      if (funcRes.ok) {
        const funcData = await funcRes.json();
        setFunctionalData(funcData);
      }

      // Load AI summary
      const aiRes = await fetch(`/api/knowledge-base/service/${serviceName}/ai`);
      if (aiRes.ok) {
        const ai = await aiRes.json();
        setAiData(ai);
      }

      // Load test analysis
      const testRes = await fetch(`/api/knowledge-base/service/${serviceName}/test`);
      if (testRes.ok) {
        const test = await testRes.json();
        setTestData(test);
      }

      // Load sequence diagrams
      const seqRes = await fetch(`/api/knowledge-base/service/${serviceName}/sequence`);
      if (seqRes.ok) {
        const seq = await seqRes.json();
        setSequenceData(seq);
      }

      // Load cached descriptions
      const cacheRes = await fetch(`/api/knowledge-base/service/${serviceName}/description-cache`);
      if (cacheRes.ok) {
        const cache = await cacheRes.json();
        setDescriptionCache(cache);
      }
    } catch (err) {
      console.error('Error loading docs:', err);
      setError('Documentation not available. Run update.sh to generate docs.');
    } finally {
      setLoading(false);
    }
  };

  const filterItems = (items, searchFields) => {
    if (!searchTerm) return items;
    const term = searchTerm.toLowerCase();
    return items.filter(item => {
      // Search in specified fields
      const fieldMatch = searchFields.some(field =>
        String(item[field] || '').toLowerCase().includes(term)
      );

      // Also search in nested arrays/objects
      const deepSearch = JSON.stringify(item).toLowerCase().includes(term);

      return fieldMatch || deepSearch;
    });
  };

  const renderOverview = () => {
    if (!functionalData) {
      return <div className="kb-empty">Functional documentation not available</div>;
    }

    return (
      <div className="kb-overview">
        <section className="kb-section">
          <h3>Purpose</h3>
          <p className="kb-purpose">{functionalData.purpose}</p>
        </section>

        {functionalData.key_features?.length > 0 && (
          <section className="kb-section">
            <h3>Key Features by Domain</h3>
            {functionalData.key_features.map((feature, idx) => {
              const generatingKey = `feature-domain:${feature.domain}`;
              const isGenerating = generatingDescriptions[generatingKey];
              const cachedDesc = descriptionCache[generatingKey];

              return (
              <div key={idx} className="kb-feature-domain">
                <div className="kb-feature-header">
                  <h4>{feature.domain}</h4>
                  {!isGenerating && (
                    <button
                      className="kb-generate-btn kb-generate-btn-small"
                      onClick={() => generateDescription('feature-domain', feature)}
                      title={cachedDesc ? "Regenerate explanation" : "Generate AI explanation for this domain"}
                    >
                      {cachedDesc ? '🔄 Regen' : '✨ Explain'}
                    </button>
                  )}
                  {isGenerating && (
                    <span className="kb-generating">⏳ Generating...</span>
                  )}
                </div>
                {cachedDesc && (
                  <div className="kb-domain-explanation">
                    <p>{cachedDesc}</p>
                  </div>
                )}
                <ul className="kb-capability-list">
                  {feature.capabilities.map((cap, cidx) => (
                    <li key={cidx}>{cap}</li>
                  ))}
                </ul>
              </div>
              );
            })}
          </section>
        )}

        {functionalData.business_capabilities?.length > 0 && (
          <section className="kb-section">
            <h3>Business Capabilities</h3>
            <div className="kb-chips">
              {functionalData.business_capabilities.map((cap, idx) => (
                <span key={idx} className="kb-chip">{cap}</span>
              ))}
            </div>
          </section>
        )}

        {functionalData.workflows?.length > 0 && (
          <section className="kb-section">
            <h3>Workflows</h3>
            {functionalData.workflows.map((workflow, idx) => (
              <div key={idx} className="kb-workflow">
                <h4>{workflow.workflow}</h4>
                <p className="kb-workflow-desc">{workflow.description}</p>
                <div className="kb-workflow-steps">
                  {workflow.steps.map((step, sidx) => (
                    <div key={sidx} className="kb-workflow-step">
                      <strong>{step.step}</strong>
                      <span className="kb-step-methods">
                        {step.methods.slice(0, 2).join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {functionalData.business_rules?.length > 0 && (
          <section className="kb-section">
            <h3>Business Rules</h3>
            <ul className="kb-rules-list">
              {functionalData.business_rules.map((rule, idx) => (
                <li key={idx}>{rule}</li>
              ))}
            </ul>
          </section>
        )}

        {functionalData.integrations?.length > 0 && (
          <section className="kb-section">
            <h3>Integrations</h3>
            {functionalData.integrations.map((integration, idx) => (
              <div key={idx} className="kb-integration">
                <strong>{integration.service}</strong>
                <span className="kb-integration-type">({integration.type})</span>
                <p>{integration.purpose}</p>
              </div>
            ))}
          </section>
        )}

        {functionalData.data_flow?.length > 0 && (
          <section className="kb-section">
            <h3>Data Flow</h3>
            <ul className="kb-flow-list">
              {functionalData.data_flow.map((flow, idx) => (
                <li key={idx}>{flow}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  };

  const renderGraphQL = () => {
    if (!graphqlData) {
      return <div className="kb-empty">No GraphQL schema found</div>;
    }

    const queries = graphqlData.queries || [];
    const mutations = graphqlData.mutations || [];
    const subscriptions = graphqlData.subscriptions || [];

    const filteredQueries = filterItems(queries, ['name', 'description', 'return_type']);
    const filteredMutations = filterItems(mutations, ['name', 'description', 'return_type']);
    const filteredSubscriptions = filterItems(subscriptions, ['name', 'description', 'return_type']);

    return (
      <div className="kb-graphql">
        {filteredQueries.length > 0 && (
          <div className="kb-method-group">
            <h3>🔍 Queries ({filteredQueries.length})</h3>
            {filteredQueries.map((query, idx) => {
              const generatingKey = `query:${query.name}`;
              const isGenerating = generatingDescriptions[generatingKey];

              return (
              <div key={idx} className="kb-endpoint-card kb-graphql-card">
                <div className="kb-endpoint-header kb-graphql-header">
                  <span className="kb-http-method method-get">QUERY</span>
                  <span className="kb-endpoint-path kb-graphql-name">{query.name}</span>
                  {!isGenerating && (
                    <button
                      className="kb-generate-btn"
                      onClick={() => generateDescription('query', query)}
                      title={query.description ? "Regenerate description" : "Generate AI description"}
                    >
                      {query.description ? '🔄 Regen' : '✨ Generate'}
                    </button>
                  )}
                  {isGenerating && (
                    <span className="kb-generating">⏳ Generating...</span>
                  )}
                </div>
                <div className="kb-endpoint-body">
                  {query.description && (
                    <div className="kb-graphql-description">
                      <p>{query.description}</p>
                    </div>
                  )}
                  {!query.description && !isGenerating && (
                    <div className="kb-no-description">
                      No description available. Click "✨ Generate" to create one using AI.
                    </div>
                  )}
                  {query.arguments && query.arguments.length > 0 && (
                    <div className="kb-arguments-section">
                      <strong>Arguments:</strong>
                      <ul className="kb-args-list">
                        {query.arguments.map((arg, aidx) => (
                          <li key={aidx}>
                            <code>{arg.name}: {arg.type}</code>
                            {arg.required && <span className="kb-required">*</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="kb-return-section">
                    <strong>Returns:</strong> <code className="kb-return-type">{query.return_type}</code>
                  </div>
                  {query.authorization && (
                    <div className="kb-auth-section">
                      <strong>Authorization:</strong>
                      <code className="kb-auth">{query.authorization}</code>
                    </div>
                  )}
                  {query.schema_file && (
                    <div className="kb-source">
                      <a href={`vscode://file${serviceData.base_path}/${query.schema_file}`} className="kb-source-link">
                        📄 {query.schema_file}
                      </a>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}

        {filteredMutations.length > 0 && (
          <div className="kb-method-group">
            <h3>✏️ Mutations ({filteredMutations.length})</h3>
            {filteredMutations.map((mutation, idx) => {
              const generatingKey = `mutation:${mutation.name}`;
              const isGenerating = generatingDescriptions[generatingKey];

              return (
              <div key={idx} className="kb-endpoint-card kb-graphql-card">
                <div className="kb-endpoint-header kb-graphql-header">
                  <span className="kb-http-method method-post">MUTATION</span>
                  <span className="kb-endpoint-path kb-graphql-name">{mutation.name}</span>
                  {!isGenerating && (
                    <button
                      className="kb-generate-btn"
                      onClick={() => generateDescription('mutation', mutation)}
                      title={mutation.description ? "Regenerate description" : "Generate AI description"}
                    >
                      {mutation.description ? '🔄 Regen' : '✨ Generate'}
                    </button>
                  )}
                  {isGenerating && (
                    <span className="kb-generating">⏳ Generating...</span>
                  )}
                </div>
                <div className="kb-endpoint-body">
                  {mutation.description && (
                    <div className="kb-graphql-description">
                      <p>{mutation.description}</p>
                    </div>
                  )}
                  {!mutation.description && !isGenerating && (
                    <div className="kb-no-description">
                      No description available. Click "✨ Generate" to create one using AI.
                    </div>
                  )}
                  {mutation.arguments && mutation.arguments.length > 0 && (
                    <div className="kb-arguments-section">
                      <strong>Arguments:</strong>
                      <ul className="kb-args-list">
                        {mutation.arguments.map((arg, aidx) => (
                          <li key={aidx}>
                            <code>{arg.name}: {arg.type}</code>
                            {arg.required && <span className="kb-required">*</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="kb-return-section">
                    <strong>Returns:</strong> <code className="kb-return-type">{mutation.return_type}</code>
                  </div>
                  {mutation.authorization && (
                    <div className="kb-auth-section">
                      <strong>Authorization:</strong>
                      <code className="kb-auth">{mutation.authorization}</code>
                    </div>
                  )}
                  {mutation.schema_file && (
                    <div className="kb-source">
                      <a href={`vscode://file${serviceData.base_path}/${mutation.schema_file}`} className="kb-source-link">
                        📄 {mutation.schema_file}
                      </a>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}

        {filteredSubscriptions.length > 0 && (
          <div className="kb-method-group">
            <h3>📡 Subscriptions ({filteredSubscriptions.length})</h3>
            {filteredSubscriptions.map((sub, idx) => (
              <div key={idx} className="kb-endpoint-card">
                <div className="kb-endpoint-header">
                  <span className="kb-http-method method-patch">SUBSCRIPTION</span>
                  <span className="kb-endpoint-path">{sub.name}</span>
                </div>
                <div className="kb-endpoint-body">
                  {sub.description && (
                    <div className="kb-description"><em>{sub.description}</em></div>
                  )}
                  {sub.arguments && sub.arguments.length > 0 && (
                    <div>
                      <strong>Arguments:</strong>
                      <ul className="kb-args-list">
                        {sub.arguments.map((arg, aidx) => (
                          <li key={aidx}>
                            <code>{arg.name}: {arg.type}</code>
                            {arg.required && <span className="kb-required">*</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div><strong>Returns:</strong> <code>{sub.return_type}</code></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderServices = () => {
    if (!serviceData?.services?.length) {
      return <div className="kb-empty">No service methods found</div>;
    }

    const filtered = filterItems(serviceData.services, ['name', 'class_name', 'return_type']);
    const grouped = filtered.reduce((acc, svc) => {
      if (!acc[svc.class_name]) acc[svc.class_name] = [];
      acc[svc.class_name].push(svc);
      return acc;
    }, {});

    return (
      <div className="kb-services">
        {Object.entries(grouped).map(([className, methods]) => (
          <div key={className} className="kb-class-group">
            <h3>{className}</h3>
            {methods.map((method, idx) => {
              const generatingKey = `service-method:${className}.${method.name}`;
              const isGenerating = generatingDescriptions[generatingKey];
              const cachedDesc = descriptionCache[generatingKey];

              // Debug logging (remove after testing)
              if (idx === 0) {
                console.log('Rendering method:', {
                  method: method.name,
                  className,
                  generatingKey,
                  hasCachedDesc: !!cachedDesc,
                  cacheKeys: Object.keys(descriptionCache).filter(k => k.startsWith('service-method')).slice(0, 3)
                });
              }

              // Get related methods in same class for context
              const relatedMethods = methods
                .filter(m => m.name !== method.name)
                .map(m => m.name)
                .slice(0, 5);

              return (
              <div key={idx} className="kb-method-card">
                <div className="kb-method-header">
                  <code className="kb-method-signature">{method.name}({method.parameters.join(', ')})</code>
                  {!isGenerating && (
                    <button
                      className="kb-generate-btn kb-generate-btn-small"
                      onClick={() => generateDescription('service-method', method, { relatedMethods })}
                      title={cachedDesc ? "Regenerate explanation" : "Generate AI explanation for this method"}
                    >
                      {cachedDesc ? '🔄 Regen' : '✨ Explain'}
                    </button>
                  )}
                  {isGenerating && (
                    <span className="kb-generating kb-generating-small">⏳</span>
                  )}
                </div>
                {cachedDesc && (
                  <div className="kb-method-explanation">
                    <p>{cachedDesc}</p>
                  </div>
                )}
                <div className="kb-method-body">
                  <div><strong>Returns:</strong> <code>{method.return_type}</code></div>
                  <div className="kb-source">
                    <a
                      href={`vscode://file${serviceData.base_path}/${method.file_path}:${method.line_number}`}
                      className="kb-source-link"
                    >
                      📄 {method.file_path}:{method.line_number}
                    </a>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  const renderEntities = () => {
    if (!serviceData?.entities?.length) {
      return <div className="kb-empty">No entities found</div>;
    }

    const filtered = filterItems(serviceData.entities, ['name', 'table_name']);

    return (
      <div className="kb-entities">
        {filtered.map((entity, idx) => (
          <div key={idx} className="kb-entity-card">
            <div className="kb-entity-header">
              <h4>{entity.name}</h4>
              {entity.table_name && (
                <span className="kb-table-name">Table: {entity.table_name}</span>
              )}
            </div>
            {entity.fields?.length > 0 && (
              <table className="kb-fields-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Type</th>
                    <th>Column</th>
                  </tr>
                </thead>
                <tbody>
                  {entity.fields.map((field, fidx) => (
                    <tr key={fidx}>
                      <td><code>{field.name}</code></td>
                      <td><code>{field.type}</code></td>
                      <td>{field.column || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="kb-source">
              <a
                href={`vscode://file${serviceData.base_path}/${entity.file_path}:${entity.line_number}`}
                className="kb-source-link"
              >
                📄 {entity.file_path}:{entity.line_number}
              </a>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderDependencies = () => {
    if (!serviceData?.dependencies?.length) {
      return <div className="kb-empty">No dependencies found</div>;
    }

    return (
      <div className="kb-dependencies">
        <ul className="kb-dep-list">
          {serviceData.dependencies.map((dep, idx) => (
            <li key={idx}><code>{dep}</code></li>
          ))}
        </ul>
      </div>
    );
  };

  const renderAISummary = () => {
    const execSummaryKey = 'ai-section:executive-summary';
    const techDiveKey = 'ai-section:technical-deep-dive';

    const execSummary = descriptionCache[execSummaryKey] || aiData?.executive_summary;
    const techDive = descriptionCache[techDiveKey] || aiData?.technical_deep_dive || aiData?.technical_overview;

    const isGeneratingExec = generatingDescriptions[execSummaryKey];
    const isGeneratingTech = generatingDescriptions[techDiveKey];

    return (
      <div className="kb-ai-summary">
        <section className="kb-section">
          <div className="kb-section-header">
            <h3>📊 Executive Summary</h3>
            {!isGeneratingExec && (
              <button
                className="kb-generate-btn kb-generate-btn-small"
                onClick={() => generateAISection('executive-summary')}
                title={execSummary && execSummary.length >= 100 ? "Regenerate executive summary" : "Generate executive summary"}
              >
                {execSummary && execSummary.length >= 100 ? '🔄 Regenerate' : '✨ Generate'}
              </button>
            )}
            {isGeneratingExec && <span className="kb-generating">⏳ Generating...</span>}
          </div>
          {execSummary && execSummary.length >= 100 ? (
            <p className="kb-ai-text">{execSummary}</p>
          ) : (
            <div className="kb-no-description">
              Click "✨ Generate" to create an executive summary for business stakeholders.
            </div>
          )}
        </section>

        <section className="kb-section">
          <div className="kb-section-header">
            <h3>🔧 Technical Deep Dive</h3>
            {!isGeneratingTech && (
              <button
                className="kb-generate-btn kb-generate-btn-small"
                onClick={() => generateAISection('technical-deep-dive')}
                title={techDive && techDive.length >= 100 ? "Regenerate technical deep dive" : "Generate technical deep dive"}
              >
                {techDive && techDive.length >= 100 ? '🔄 Regenerate' : '✨ Generate'}
              </button>
            )}
            {isGeneratingTech && <span className="kb-generating">⏳ Generating...</span>}
          </div>
          {techDive && techDive.length >= 100 ? (
            <div className="kb-ai-text">
              {techDive.split('\n').map((line, idx) => {
                // Check if it's a bullet point
                if (line.trim().startsWith('•')) {
                  // Parse bullet with bold label
                  const match = line.match(/^•\s*\*\*(.+?)\*\*:\s*(.+)$/);
                  if (match) {
                    return (
                      <div key={idx} className="kb-tech-bullet">
                        <strong>{match[1]}:</strong> {match[2]}
                      </div>
                    );
                  }
                  // Regular bullet
                  return <div key={idx} className="kb-tech-bullet">{line.replace('•', '').trim()}</div>;
                }
                // Regular paragraph
                return line.trim() ? <p key={idx}>{line}</p> : null;
              })}
            </div>
          ) : (
            <div className="kb-no-description">
              Click "✨ Generate" to create a technical deep dive for developers and architects.
            </div>
          )}
        </section>

        {aiData.feature_analysis?.length > 0 && (
          <section className="kb-section">
            <h3>⚡ Feature Analysis</h3>
            {aiData.feature_analysis.map((feature, idx) => (
              <div key={idx} className="kb-feature-analysis">
                <h4>{feature.domain}</h4>
                <p>{feature.analysis}</p>
                <div className="kb-chips">
                  {feature.capabilities.slice(0, 5).map((cap, cidx) => (
                    <span key={cidx} className="kb-chip-small">{cap}</span>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {aiData.architecture_analysis && (
          <section className="kb-section">
            <h3>🏗️ Architecture Analysis</h3>
            <p className="kb-ai-text">{aiData.architecture_analysis.full_analysis}</p>
            {aiData.architecture_analysis.key_patterns?.length > 0 && (
              <div className="kb-patterns">
                <strong>Design Patterns:</strong>
                <div className="kb-chips">
                  {aiData.architecture_analysis.key_patterns.map((pattern, idx) => (
                    <span key={idx} className="kb-chip">{pattern}</span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {aiData.use_case_scenarios?.length > 0 && (
          <section className="kb-section">
            <h3>🎯 Use Case Scenarios</h3>
            <ul className="kb-use-case-list">
              {aiData.use_case_scenarios.map((useCase, idx) => (
                <li key={idx}>{useCase}</li>
              ))}
            </ul>
          </section>
        )}

        {aiData.code_quality_insights && (
          <section className="kb-section">
            <h3>📈 Code Quality Insights</h3>
            <p className="kb-ai-text">{aiData.code_quality_insights.overall_analysis}</p>
            {aiData.code_quality_insights.metrics && (
              <div className="kb-metrics">
                <div className="kb-metric">
                  <span className="kb-metric-label">Methods per Domain:</span>
                  <span className="kb-metric-value">{aiData.code_quality_insights.metrics.methods_per_domain}</span>
                </div>
              </div>
            )}
          </section>
        )}

        {aiData.recommendations?.length > 0 && (
          <section className="kb-section">
            <h3>💡 Recommendations</h3>
            <ul className="kb-recommendations-list">
              {aiData.recommendations.map((rec, idx) => (
                <li key={idx}>{rec}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  };

  const renderUseCases = () => {
    if (!testData || !testData.use_cases?.length) {
      return <div className="kb-empty">No test-based use cases found</div>;
    }

    return (
      <div className="kb-use-cases">
        <h3>Use Cases from Tests</h3>
        {testData.use_cases.map((useCase, idx) => (
          <div key={idx} className="kb-use-case-card">
            <h4>{useCase.description}</h4>
            <div className="kb-gwt">
              <div className="kb-gwt-item">
                <strong>Given:</strong> {useCase.given}
              </div>
              <div className="kb-gwt-item">
                <strong>When:</strong> {useCase.when}
              </div>
              <div className="kb-gwt-item">
                <strong>Then:</strong> {useCase.then}
              </div>
            </div>
            <div className="kb-test-source">From: {useCase.test_file}</div>
          </div>
        ))}

        {testData.edge_cases?.length > 0 && (
          <section className="kb-section" style={{marginTop: '32px'}}>
            <h3>Edge Cases & Error Handling</h3>
            <ul className="kb-edge-case-list">
              {testData.edge_cases.map((edge, idx) => (
                <li key={idx}>{edge}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  };

  const renderDiagrams = () => {
    if (!sequenceData || !sequenceData.diagrams?.length) {
      return <div className="kb-empty">No sequence diagrams available</div>;
    }

    return (
      <div className="kb-diagrams">
        {sequenceData.diagrams.map((diagram, idx) => (
          <section key={idx} className="kb-section">
            <h3>{diagram.name}</h3>
            <p className="kb-diagram-desc">{diagram.description}</p>
            <div className="kb-mermaid">
              <pre><code>{diagram.mermaid}</code></pre>
            </div>
            <div className="kb-diagram-note">
              📊 Copy this Mermaid code to <a href="https://mermaid.live" target="_blank" rel="noopener noreferrer">mermaid.live</a> to visualize
            </div>
          </section>
        ))}

        {sequenceData.integration_diagrams?.length > 0 && (
          <>
            <h3 style={{marginTop: '32px'}}>Integration Diagrams</h3>
            {sequenceData.integration_diagrams.map((diagram, idx) => (
              <section key={idx} className="kb-section">
                <h4>{diagram.name}</h4>
                <p className="kb-diagram-desc">{diagram.description}</p>
                <div className="kb-mermaid">
                  <pre><code>{diagram.mermaid}</code></pre>
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="kb-modal">
        <div className="kb-modal-content">
          <div className="kb-loading">Loading documentation...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="kb-modal">
        <div className="kb-modal-content">
          <div className="kb-header">
            <h2>Documentation</h2>
            <button className="kb-close" onClick={onClose}>×</button>
          </div>
          <div className="kb-error">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="kb-modal" onClick={onClose}>
      <div className="kb-modal-content" onClick={e => e.stopPropagation()}>
        <div className="kb-header">
          <div>
            <h2>{serviceData.service_name}</h2>
            <div className="kb-stats">
              {graphqlData && (graphqlData.queries?.length > 0 || graphqlData.mutations?.length > 0) ? (
                <>
                  <span className="kb-badge">{graphqlData.queries?.length || 0} queries</span>
                  <span className="kb-badge">{graphqlData.mutations?.length || 0} mutations</span>
                </>
              ) : (
                <span className="kb-badge">{serviceData.endpoints?.length || 0} REST endpoints</span>
              )}
              <span className="kb-badge">{serviceData.services?.length || 0} service methods</span>
              <span className="kb-badge">{serviceData.entities?.length || 0} entities</span>
            </div>
          </div>
          <button className="kb-close" onClick={onClose}>×</button>
        </div>

        <div className="kb-search">
          <input
            type="text"
            placeholder="Search documentation..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="kb-search-input"
          />
        </div>

        <div className="kb-tabs">
          <button
            className={`kb-tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            📋 Overview
          </button>
          {aiData && (
            <button
              className={`kb-tab ${activeTab === 'ai' ? 'active' : ''}`}
              onClick={() => setActiveTab('ai')}
            >
              🤖 AI Summary
            </button>
          )}
          {testData && (
            <button
              className={`kb-tab ${activeTab === 'usecases' ? 'active' : ''}`}
              onClick={() => setActiveTab('usecases')}
            >
              🎯 Use Cases
            </button>
          )}
          {sequenceData && (
            <button
              className={`kb-tab ${activeTab === 'diagrams' ? 'active' : ''}`}
              onClick={() => setActiveTab('diagrams')}
            >
              📊 Diagrams
            </button>
          )}
          {graphqlData && (graphqlData.queries?.length > 0 || graphqlData.mutations?.length > 0) && (
            <button
              className={`kb-tab ${activeTab === 'graphql' ? 'active' : ''}`}
              onClick={() => setActiveTab('graphql')}
            >
              🔷 GraphQL API
            </button>
          )}
          <button
            className={`kb-tab ${activeTab === 'services' ? 'active' : ''}`}
            onClick={() => setActiveTab('services')}
          >
            ⚙️ Services
          </button>
          <button
            className={`kb-tab ${activeTab === 'entities' ? 'active' : ''}`}
            onClick={() => setActiveTab('entities')}
          >
            📦 Entities
          </button>
          <button
            className={`kb-tab ${activeTab === 'dependencies' ? 'active' : ''}`}
            onClick={() => setActiveTab('dependencies')}
          >
            🔗 Dependencies
          </button>
        </div>

        <div className="kb-content">
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'ai' && renderAISummary()}
          {activeTab === 'usecases' && renderUseCases()}
          {activeTab === 'diagrams' && renderDiagrams()}
          {activeTab === 'graphql' && renderGraphQL()}
          {activeTab === 'services' && renderServices()}
          {activeTab === 'entities' && renderEntities()}
          {activeTab === 'dependencies' && renderDependencies()}
        </div>
      </div>
    </div>
  );
}

export default KnowledgeBase;
