// Enhanced Business File Processor Edge Function
// 处理已上传到Storage的业务分析文件，提供深度分析能力

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'false'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const requestData = await req.json();
    const { fileName, fileType, fileSize, storagePath, publicUrl, analysisQuery } = requestData;

    // 验证输入参数
    if (!fileName || !storagePath) {
      return new Response(JSON.stringify({ 
        error: { 
          code: 'INVALID_INPUT', 
          message: '缺少必要的文件信息' 
        } 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`处理文件: ${fileName}, Storage Path: ${storagePath}`);

    // 从公开URL获取文件内容
    const fileContent = await fetchFileContent(publicUrl);
    
    // 根据文件类型进行深度分析
    const fileExtension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    let analysisResult;
    
    switch (fileExtension) {
      case '.py':
        analysisResult = await analyzePythonFileDeep(fileContent, fileName);
        break;
        
      case '.json':
        analysisResult = await analyzeJSONFileDeep(fileContent, fileName);
        break;
        
      case '.yaml':
      case '.yml':
        analysisResult = await analyzeYAMLFileDeep(fileContent, fileName);
        break;
        
      case '.csv':
        analysisResult = await analyzeCSVFileDeep(fileContent, fileName);
        break;
        
      default:
        throw new Error(`不支持的文件类型: ${fileExtension}`);
    }

    // 生成综合分析报告
    const comprehensiveReport = await generateComprehensiveReport(analysisResult, fileName, fileSize);
    
    // 生成可行性建议
    const recommendations = await generateBusinessRecommendations(analysisResult, fileExtension);

    const response = {
      success: true,
      fileInfo: {
        name: fileName,
        type: fileType,
        size: fileSize,
        storagePath,
        publicUrl
      },
      analysisResult: analysisResult,
      comprehensiveReport,
      recommendations,
      analysisMetadata: {
        processedAt: new Date().toISOString(),
        fileExtension,
        analysisDepth: 'comprehensive',
        securityStatus: analysisResult.securityAnalysis?.status || 'unknown'
      },
      timestamp: new Date().toISOString()
    };

    return new Response(JSON.stringify({ data: response }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Enhanced file processing error:', error);
    
    const errorResponse = {
      error: {
        code: 'FILE_PROCESSING_ERROR',
        message: error.message || '文件分析处理失败'
      }
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// 获取文件内容
async function fetchFileContent(publicUrl: string): Promise<string> {
  try {
    const response = await fetch(publicUrl);
    if (!response.ok) {
      throw new Error(`无法获取文件内容: ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    throw new Error(`文件内容获取失败: ${error.message}`);
  }
}

// 深度分析Python文件
async function analyzePythonFileDeep(content: string, fileName: string) {
  // 安全分析
  const securityAnalysis = await analyzePythonSecurity(content);
  
  // 代码结构分析
  const structureAnalysis = await analyzePythonStructure(content);
  
  // 复杂度分析
  const complexityAnalysis = await analyzePythonComplexity(content);
  
  // 依赖分析
  const dependencyAnalysis = await analyzePythonDependencies(content);
  
  // 性能分析
  const performanceAnalysis = await analyzePythonPerformance(content);
  
  // 业务逻辑分析
  const businessLogicAnalysis = await analyzePythonBusinessLogic(content);

  return {
    type: 'python_deep_analysis',
    securityAnalysis,
    structureAnalysis,
    complexityAnalysis,
    dependencyAnalysis,
    performanceAnalysis,
    businessLogicAnalysis,
    summary: generatePythonAnalysisSummary({
      securityAnalysis,
      structureAnalysis,
      complexityAnalysis,
      dependencyAnalysis,
      performanceAnalysis,
      businessLogicAnalysis
    })
  };
}

// Python安全分析
async function analyzePythonSecurity(content: string) {
  const securityIssues = [];
  const warnings = [];
  
  // 危险模式检测
  const dangerousPatterns = {
    'eval/exec 使用': /\b(eval|exec)\s*\(/gi,
    '系统命令执行': /\b(os\.system|subprocess\.call|subprocess\.run|subprocess\.Popen)\s*\(/gi,
    '文件系统操作': /\bopen\s*\([^)]*['"]\w*['"]\s*,\s*['"]w/gi,
    '网络请求': /\b(urllib|requests|http\.client)\./gi,
    '__import__ 使用': /__import__\s*\(/gi,
    '动态代码执行': /\bcompile\s*\(/gi
  };
  
  for (const [issue, pattern] of Object.entries(dangerousPatterns)) {
    const matches = content.match(pattern);
    if (matches) {
      securityIssues.push({
        type: issue,
        count: matches.length,
        severity: getSeverityLevel(issue),
        description: getSecurityDescription(issue)
      });
    }
  }
  
  // 硬编码敏感信息
  const sensitivePatterns = {
    '密码硬编码': /\b(password|passwd|pwd)\s*=\s*['"][^'"]+['"]/gi,
    'API密钥': /\b(api_key|apikey|secret_key)\s*=\s*['"][^'"]+['"]/gi,
    '数据库连接': /\b(host|server)\s*=\s*['"][^'"]*localhost[^'"]*['"]/gi
  };
  
  for (const [type, pattern] of Object.entries(sensitivePatterns)) {
    if (pattern.test(content)) {
      warnings.push({
        type,
        description: `发现可能的${type}，建议使用环境变量`
      });
    }
  }
  
  const status = securityIssues.length === 0 ? 'safe' : securityIssues.some(i => i.severity === 'high') ? 'dangerous' : 'warning';
  
  return {
    status,
    issues: securityIssues,
    warnings,
    recommendation: getSecurityRecommendation(status, securityIssues)
  };
}

// Python结构分析
async function analyzePythonStructure(content: string) {
  const lines = content.split('\n');
  
  // 提取函数
  const functionMatches = content.match(/^\s*def\s+(\w+)\s*\([^)]*\):/gm) || [];
  const functions = functionMatches.map(match => {
    const nameMatch = match.match(/def\s+(\w+)/);
    return nameMatch ? nameMatch[1] : 'unknown';
  });
  
  // 提取类
  const classMatches = content.match(/^\s*class\s+(\w+)/gm) || [];
  const classes = classMatches.map(match => {
    const nameMatch = match.match(/class\s+(\w+)/);
    return nameMatch ? nameMatch[1] : 'unknown';
  });
  
  // 提取导入
  const importMatches = content.match(/^\s*(?:from\s+[\w.]+\s+)?import\s+[\w.,\s*]+/gm) || [];
  const imports = importMatches.map(match => match.trim());
  
  // 计算缩进层次
  const indentationLevels = lines.map(line => {
    const match = line.match(/^(\s*)/);
    return match ? Math.floor(match[1].length / 4) : 0;
  }).filter(level => level > 0);
  
  const maxIndentation = Math.max(...indentationLevels, 0);
  const avgIndentation = indentationLevels.length > 0 
    ? indentationLevels.reduce((a, b) => a + b) / indentationLevels.length 
    : 0;
  
  return {
    totalLines: lines.length,
    codeLines: lines.filter(line => line.trim() && !line.trim().startsWith('#')).length,
    commentLines: lines.filter(line => line.trim().startsWith('#')).length,
    functions: {
      count: functions.length,
      names: functions
    },
    classes: {
      count: classes.length,
      names: classes
    },
    imports: {
      count: imports.length,
      statements: imports
    },
    indentation: {
      maxLevel: maxIndentation,
      averageLevel: Math.round(avgIndentation * 100) / 100
    }
  };
}

// Python复杂度分析
async function analyzePythonComplexity(content: string) {
  const lines = content.split('\n');
  
  // 循环复杂度 (McCabe)
  let cyclomaticComplexity = 1; // 基础值
  const complexityPatterns = [
    /\bif\b/gi,
    /\bfor\b/gi,
    /\bwhile\b/gi,
    /\btry\b/gi,
    /\bexcept\b/gi,
    /\belif\b/gi,
    /\band\b/gi,
    /\bor\b/gi
  ];
  
  for (const pattern of complexityPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      cyclomaticComplexity += matches.length;
    }
  }
  
  // 嵌套深度
  let maxNestingDepth = 0;
  let currentDepth = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^(if|for|while|with|try|def|class)\b/)) {
      currentDepth++;
      maxNestingDepth = Math.max(maxNestingDepth, currentDepth);
    } else if (trimmed === '' && line.length === 0) {
      currentDepth = Math.max(0, currentDepth - 1);
    }
  }
  
  // 复杂度等级评估
  let complexityLevel = 'low';
  if (cyclomaticComplexity > 15) complexityLevel = 'high';
  else if (cyclomaticComplexity > 8) complexityLevel = 'medium';
  
  return {
    cyclomaticComplexity,
    maxNestingDepth,
    complexityLevel,
    maintainabilityScore: calculateMaintainabilityScore(cyclomaticComplexity, maxNestingDepth, lines.length)
  };
}

// Python依赖分析
async function analyzePythonDependencies(content: string) {
  const importMatches = content.match(/^\s*(?:from\s+([\w.]+)\s+)?import\s+([\w.,\s*]+)/gm) || [];
  
  const dependencies = {
    standard: [],
    thirdParty: [],
    local: []
  };
  
  const standardLibraries = [
    'os', 'sys', 'json', 'csv', 'datetime', 'time', 'math', 'random',
    'collections', 'itertools', 'functools', 're', 'urllib', 'http'
  ];
  
  const popularLibraries = [
    'pandas', 'numpy', 'matplotlib', 'seaborn', 'sklearn', 'tensorflow',
    'torch', 'requests', 'flask', 'django', 'sqlalchemy', 'pymongo'
  ];
  
  for (const importStatement of importMatches) {
    const fromMatch = importStatement.match(/from\s+([\w.]+)/);
    const importMatch = importStatement.match(/import\s+([\w.,\s*]+)/);
    
    const moduleName = fromMatch ? fromMatch[1].split('.')[0] : importMatch[1].split(',')[0].trim().split('.')[0];
    
    if (standardLibraries.includes(moduleName)) {
      dependencies.standard.push(moduleName);
    } else if (popularLibraries.includes(moduleName)) {
      dependencies.thirdParty.push(moduleName);
    } else {
      dependencies.local.push(moduleName);
    }
  }
  
  return {
    total: importMatches.length,
    breakdown: dependencies,
    riskAssessment: assessDependencyRisk(dependencies)
  };
}

// Python性能分析
async function analyzePythonPerformance(content: string) {
  const performanceIssues = [];
  
  // 性能反模式检测
  const antiPatterns = {
    '循环中的字符串连接': /for\s+\w+\s+in\s+.*:\s*\w+\s*\+=\s*.*str/gi,
    '全局变量访问': /global\s+\w+/gi,
    '反复计算': /for\s+.*:\s*.*len\s*\(/gi,
    '嵌套循环': /for\s+.*:\s*.*for\s+.*:/gi
  };
  
  for (const [issue, pattern] of Object.entries(antiPatterns)) {
    const matches = content.match(pattern);
    if (matches) {
      performanceIssues.push({
        type: issue,
        count: matches.length,
        impact: getPerformanceImpact(issue)
      });
    }
  }
  
  // 算法复杂度估算
  const complexityIndicators = {
    'O(n²)': content.match(/for\s+.*:\s*.*for\s+.*:/gi)?.length || 0,
    'O(n)': content.match(/for\s+.*:/gi)?.length || 0,
    'O(log n)': content.match(/\bsorted\s*\(|\b\.sort\s*\(/gi)?.length || 0
  };
  
  return {
    issues: performanceIssues,
    complexityIndicators,
    optimizationScore: calculateOptimizationScore(performanceIssues, complexityIndicators)
  };
}

// Python业务逻辑分析
async function analyzePythonBusinessLogic(content: string) {
  // 识别业务领域
  const businessDomains = {
    '财务分析': /\b(profit|revenue|cost|price|margin|roi|financial)\b/gi,
    '数据分析': /\b(pandas|numpy|matplotlib|seaborn|analysis|data)\b/gi,
    '机器学习': /\b(sklearn|tensorflow|torch|model|predict|train)\b/gi,
    'Web开发': /\b(flask|django|request|response|api)\b/gi,
    '数据库': /\b(sql|database|query|select|insert|update)\b/gi
  };
  
  const detectedDomains = [];
  for (const [domain, pattern] of Object.entries(businessDomains)) {
    if (pattern.test(content)) {
      const matches = content.match(pattern);
      detectedDomains.push({
        domain,
        confidence: matches ? Math.min(matches.length * 10, 100) : 0,
        keywords: matches ? matches.slice(0, 5) : []
      });
    }
  }
  
  // 函数用途分析
  const functionPurposes = analyzeFunctionPurposes(content);
  
  return {
    detectedDomains,
    functionPurposes,
    businessValue: assessBusinessValue(detectedDomains, functionPurposes)
  };
}

// 深度分析JSON文件
async function analyzeJSONFileDeep(content: string, fileName: string) {
  try {
    const data = JSON.parse(content);
    
    const structureAnalysis = analyzeJSONStructure(data);
    const schemaAnalysis = inferJSONSchema(data);
    const dataQualityAnalysis = analyzeJSONDataQuality(data);
    const businessAnalysis = analyzeJSONBusinessContext(data, fileName);
    
    return {
      type: 'json_deep_analysis',
      isValid: true,
      structureAnalysis,
      schemaAnalysis,
      dataQualityAnalysis,
      businessAnalysis,
      summary: generateJSONAnalysisSummary(data, structureAnalysis)
    };
  } catch (error) {
    return {
      type: 'json_deep_analysis',
      isValid: false,
      error: `JSON解析失败: ${error.message}`,
      suggestion: '请检查JSON格式是否正确'
    };
  }
}

// 深度分析CSV文件
async function analyzeCSVFileDeep(content: string, fileName: string) {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) {
    throw new Error('CSV文件为空');
  }

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const dataRows = lines.slice(1).map(line => line.split(',').map(cell => cell.trim().replace(/"/g, '')));
  
  const dataAnalysis = analyzeCSVData(headers, dataRows);
  const qualityAnalysis = analyzeCSVQuality(headers, dataRows);
  const statisticsAnalysis = generateCSVStatistics(headers, dataRows);
  const businessInsights = generateCSVBusinessInsights(headers, dataRows, fileName);
  
  return {
    type: 'csv_deep_analysis',
    dataAnalysis,
    qualityAnalysis,
    statisticsAnalysis,
    businessInsights,
    summary: generateCSVAnalysisSummary(headers, dataRows, dataAnalysis)
  };
}

// YAML深度分析
async function analyzeYAMLFileDeep(content: string, fileName: string) {
  const structureAnalysis = analyzeYAMLStructure(content);
  const configurationAnalysis = analyzeYAMLConfiguration(content);
  const validationAnalysis = validateYAMLSyntax(content);
  const securityAnalysis = analyzeYAMLSecurity(content);
  
  return {
    type: 'yaml_deep_analysis',
    structureAnalysis,
    configurationAnalysis,
    validationAnalysis,
    securityAnalysis,
    summary: generateYAMLAnalysisSummary(structureAnalysis, configurationAnalysis)
  };
}

// 生成综合分析报告
async function generateComprehensiveReport(analysisResult: any, fileName: string, fileSize: number) {
  const report = {
    executiveSummary: generateExecutiveSummary(analysisResult),
    keyFindings: extractKeyFindings(analysisResult),
    riskAssessment: generateRiskAssessment(analysisResult),
    recommendations: generateDetailedRecommendations(analysisResult),
    fileMetrics: {
      fileName,
      fileSize,
      complexity: analysisResult.complexityAnalysis?.complexityLevel || 'unknown',
      quality: assessOverallQuality(analysisResult)
    }
  };
  
  return report;
}

// 生成业务建议
async function generateBusinessRecommendations(analysisResult: any, fileType: string) {
  const recommendations = [];
  
  switch (fileType) {
    case '.py':
      if (analysisResult.securityAnalysis?.status === 'dangerous') {
        recommendations.push({
          priority: 'high',
          category: '安全性',
          action: '立即修复安全问题',
          details: '检测到高风险代码模式，建议重构代码或使用更安全的替代方案'
        });
      }
      if (analysisResult.complexityAnalysis?.complexityLevel === 'high') {
        recommendations.push({
          priority: 'medium',
          category: '代码质量',
          action: '代码重构和模块化',
          details: '代码复杂度过高，建议拆分为更小的函数或模块'
        });
      }
      break;
      
    case '.csv':
      if (analysisResult.qualityAnalysis?.issues?.length > 0) {
        recommendations.push({
          priority: 'medium',
          category: '数据质量',
          action: '清理数据质量问题',
          details: '数据集存在质量问题，建议在分析前进行数据清洗'
        });
      }
      break;
  }
  
  return recommendations;
}

// 辅助函数

function getSeverityLevel(issueType: string): string {
  const highSeverity = ['eval/exec 使用', '系统命令执行', '动态代码执行'];
  return highSeverity.includes(issueType) ? 'high' : 'medium';
}

function getSecurityDescription(issueType: string): string {
  const descriptions = {
    'eval/exec 使用': '使用eval()或exec()可能导致代码注入攻击',
    '系统命令执行': '系统命令执行可能导致命令注入漏洞',
    '文件系统操作': '文件写入操作可能对系统造成风险',
    '网络请求': '网络请求可能泄露敏感信息',
    '__import__ 使用': '动态导入可能被恶意利用',
    '动态代码执行': '动态编译代码存在安全风险'
  };
  return descriptions[issueType] || '未知安全风险';
}

function getSecurityRecommendation(status: string, issues: any[]): string {
  if (status === 'safe') {
    return '代码安全性良好，可以在限制环境中运行';
  } else if (status === 'warning') {
    return '存在一些潜在风险，建议在沙箱环境中运行并加强监控';
  } else {
    return '存在高风险操作，不建议执行，需要重构代码';
  }
}

function calculateMaintainabilityScore(complexity: number, nesting: number, lines: number): number {
  const complexityScore = Math.max(0, 100 - complexity * 2);
  const nestingScore = Math.max(0, 100 - nesting * 10);
  const sizeScore = Math.max(0, 100 - Math.floor(lines / 10));
  
  return Math.round((complexityScore + nestingScore + sizeScore) / 3);
}

function assessDependencyRisk(dependencies: any): string {
  const thirdPartyCount = dependencies.thirdParty.length;
  if (thirdPartyCount > 10) return 'high';
  if (thirdPartyCount > 5) return 'medium';
  return 'low';
}

function getPerformanceImpact(issue: string): string {
  const impacts = {
    '循环中的字符串连接': 'high',
    '全局变量访问': 'medium',
    '反复计算': 'medium',
    '嵌套循环': 'high'
  };
  return impacts[issue] || 'low';
}

function calculateOptimizationScore(issues: any[], complexityIndicators: any): number {
  let score = 100;
  
  for (const issue of issues) {
    if (issue.impact === 'high') score -= 20;
    else if (issue.impact === 'medium') score -= 10;
    else score -= 5;
  }
  
  // 根据算法复杂度调整
  if (complexityIndicators['O(n²)'] > 0) score -= 30;
  
  return Math.max(0, score);
}

function analyzeFunctionPurposes(content: string): any[] {
  const functionMatches = content.match(/def\s+(\w+)\s*\([^)]*\):[^\n]*(?:\n\s+"""[^"]*""")?/g) || [];
  
  return functionMatches.map(match => {
    const nameMatch = match.match(/def\s+(\w+)/);
    const docMatch = match.match(/"""([^"]*)"""/); 
    
    return {
      name: nameMatch ? nameMatch[1] : 'unknown',
      purpose: docMatch ? docMatch[1].trim() : '无描述',
      category: categorizeFunctionName(nameMatch ? nameMatch[1] : '')
    };
  });
}

function categorizeFunctionName(name: string): string {
  if (name.includes('calculate') || name.includes('compute')) return '计算';
  if (name.includes('analyze') || name.includes('process')) return '分析';
  if (name.includes('load') || name.includes('read')) return '数据加载';
  if (name.includes('save') || name.includes('write')) return '数据保存';
  if (name.includes('validate') || name.includes('check')) return '验证';
  return '其他';
}

function assessBusinessValue(domains: any[], functions: any[]): string {
  const highValueDomains = ['财务分析', '数据分析', '机器学习'];
  const hasHighValue = domains.some(d => highValueDomains.includes(d.domain) && d.confidence > 50);
  
  if (hasHighValue && functions.length > 3) return 'high';
  if (domains.length > 0) return 'medium';
  return 'low';
}

// JSON分析辅助函数
function analyzeJSONStructure(data: any): any {
  return {
    type: typeof data,
    keys: Array.isArray(data) ? data.length : (typeof data === 'object' ? Object.keys(data).length : 0),
    depth: calculateJSONDepth(data),
    size: JSON.stringify(data).length
  };
}

function calculateJSONDepth(obj: any, currentDepth = 0): number {
  if (typeof obj !== 'object' || obj === null) return currentDepth;
  
  let maxDepth = currentDepth;
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const depth = calculateJSONDepth(obj[key], currentDepth + 1);
      maxDepth = Math.max(maxDepth, depth);
    }
  }
  
  return maxDepth;
}

function inferJSONSchema(data: any): any {
  if (Array.isArray(data)) {
    return {
      type: 'array',
      items: data.length > 0 ? inferJSONSchema(data[0]) : { type: 'unknown' }
    };
  } else if (typeof data === 'object' && data !== null) {
    const properties = {};
    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        properties[key] = inferJSONSchema(data[key]);
      }
    }
    return { type: 'object', properties };
  } else {
    return { type: typeof data };
  }
}

// 综合评估函数
function generateExecutiveSummary(analysis: any): string {
  let summary = '本文件已经进行了全面的深度分析。';
  
  if (analysis.securityAnalysis) {
    summary += `安全状态: ${analysis.securityAnalysis.status}. `;
  }
  
  if (analysis.complexityAnalysis) {
    summary += `代码复杂度: ${analysis.complexityAnalysis.complexityLevel}. `;
  }
  
  return summary;
}

function extractKeyFindings(analysis: any): string[] {
  const findings = [];
  
  if (analysis.securityAnalysis?.issues?.length > 0) {
    findings.push(`发现 ${analysis.securityAnalysis.issues.length} 个安全问题`);
  }
  
  if (analysis.performanceAnalysis?.issues?.length > 0) {
    findings.push(`识别到 ${analysis.performanceAnalysis.issues.length} 个性能问题`);
  }
  
  if (analysis.businessLogicAnalysis?.detectedDomains?.length > 0) {
    findings.push(`检测到 ${analysis.businessLogicAnalysis.detectedDomains.length} 个业务领域`);
  }
  
  return findings;
}

function generateRiskAssessment(analysis: any): any {
  return {
    overall: assessOverallRisk(analysis),
    security: analysis.securityAnalysis?.status || 'unknown',
    complexity: analysis.complexityAnalysis?.complexityLevel || 'unknown',
    maintenance: analysis.complexityAnalysis?.maintainabilityScore || 0
  };
}

function generateDetailedRecommendations(analysis: any): string[] {
  const recommendations = [];
  
  if (analysis.securityAnalysis?.status === 'dangerous') {
    recommendations.push('立即处理所有高风险安全问题');
  }
  
  if (analysis.complexityAnalysis?.complexityLevel === 'high') {
    recommendations.push('考虑重构代码以降低复杂度');
  }
  
  if (analysis.performanceAnalysis?.optimizationScore < 70) {
    recommendations.push('优化代码性能，消除性能反模式');
  }
  
  return recommendations;
}

function assessOverallQuality(analysis: any): string {
  let score = 100;
  
  if (analysis.securityAnalysis?.status === 'dangerous') score -= 40;
  else if (analysis.securityAnalysis?.status === 'warning') score -= 20;
  
  if (analysis.complexityAnalysis?.complexityLevel === 'high') score -= 30;
  else if (analysis.complexityAnalysis?.complexityLevel === 'medium') score -= 15;
  
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

function assessOverallRisk(analysis: any): string {
  if (analysis.securityAnalysis?.status === 'dangerous') return 'high';
  if (analysis.complexityAnalysis?.complexityLevel === 'high') return 'medium';
  return 'low';
}

// CSV分析辅助函数
function analyzeCSVData(headers: string[], rows: string[][]): any {
  const columnTypes = headers.map(header => {
    const values = rows.map(row => row[headers.indexOf(header)]).filter(v => v && v.trim());
    return {
      name: header,
      type: inferColumnType(values),
      uniqueValues: new Set(values).size,
      nullCount: rows.length - values.length
    };
  });
  
  return {
    totalRows: rows.length,
    totalColumns: headers.length,
    columnTypes,
    estimatedMemory: estimateCSVMemoryUsage(headers, rows)
  };
}

function inferColumnType(values: string[]): string {
  if (values.length === 0) return 'unknown';
  
  const numericCount = values.filter(v => !isNaN(parseFloat(v))).length;
  const dateCount = values.filter(v => !isNaN(Date.parse(v))).length;
  
  if (numericCount / values.length > 0.8) return 'numeric';
  if (dateCount / values.length > 0.6) return 'date';
  return 'text';
}

function analyzeCSVQuality(headers: string[], rows: string[][]): any {
  const issues = [];
  
  // 检查空值
  const emptyPercentage = rows.reduce((acc, row) => 
    acc + row.filter(cell => !cell || !cell.trim()).length, 0) / (rows.length * headers.length) * 100;
  
  if (emptyPercentage > 10) {
    issues.push(`数据集包含 ${emptyPercentage.toFixed(1)}% 的空值`);
  }
  
  // 检查重复行
  const uniqueRows = new Set(rows.map(row => row.join(',')));
  if (uniqueRows.size < rows.length) {
    issues.push(`发现 ${rows.length - uniqueRows.size} 行重复数据`);
  }
  
  return {
    issues,
    qualityScore: Math.max(0, 100 - issues.length * 20),
    emptyPercentage
  };
}

function generateCSVStatistics(headers: string[], rows: string[][]): any {
  const numericColumns = [];
  
  headers.forEach((header, index) => {
    const values = rows.map(row => parseFloat(row[index])).filter(v => !isNaN(v));
    if (values.length > rows.length * 0.5) {
      numericColumns.push({
        name: header,
        count: values.length,
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        stdDev: calculateStandardDeviation(values)
      });
    }
  });
  
  return { numericColumns };
}

function calculateStandardDeviation(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function generateCSVBusinessInsights(headers: string[], rows: string[][], fileName: string): any {
  const insights = [];
  
  // 根据文件名和列名推断业务类型
  const businessKeywords = {
    '财务': /revenue|profit|cost|price|sales|income|expense/i,
    '用户': /user|customer|client|member/i,
    '产品': /product|item|sku|inventory/i,
    '日期': /date|time|year|month|day/i
  };
  
  for (const [category, pattern] of Object.entries(businessKeywords)) {
    const matchingHeaders = headers.filter(header => pattern.test(header));
    if (matchingHeaders.length > 0) {
      insights.push(`检测到${category}相关字段: ${matchingHeaders.join(', ')}`);
    }
  }
    
  return { insights };
}

// YAML分析辅助函数
function analyzeYAMLStructure(content: string): any {
  const lines = content.split('\n').filter(line => line.trim());
  const sections = lines.filter(line => !line.startsWith(' ') && line.includes(':'));
  
  return {
    totalLines: lines.length,
    sections: sections.length,
    sectionNames: sections.map(s => s.split(':')[0].trim()),
    indentationLevels: Math.max(...lines.map(line => {
      const match = line.match(/^(\s*)/);
      return match ? Math.floor(match[1].length / 2) : 0;
    }), 0)
  };
}

function analyzeYAMLConfiguration(content: string): any {
  const configPatterns = {
    '数据库配置': /\b(database|db|host|port|username|password)\s*:/gi,
    'API配置': /\b(api|endpoint|key|secret|token)\s*:/gi,
    '环境配置': /\b(environment|env|debug|production)\s*:/gi
  };
  
  const detectedConfigs = [];
  for (const [type, pattern] of Object.entries(configPatterns)) {
    if (pattern.test(content)) {
      detectedConfigs.push(type);
    }
  }
  
  return { detectedConfigs };
}

function validateYAMLSyntax(content: string): any {
  const issues = [];
  const lines = content.split('\n');
  
  lines.forEach((line, index) => {
    if (line.trim() && !line.startsWith('#')) {
      if (line.includes(':') && !line.match(/^\s*\w+:/)) {
        issues.push(`第${index + 1}行: 可能的语法错误`);
      }
    }
  });
  
  return {
    isValid: issues.length === 0,
    issues
  };
}

function analyzeYAMLSecurity(content: string): any {
  const securityIssues = [];
  
  if (/password\s*:\s*[^\n]+/i.test(content)) {
    securityIssues.push('检测到明文密码');
  }
  
  if (/secret\s*:\s*[^\n]+/i.test(content)) {
    securityIssues.push('检测到密钥信息');
  }
  
  return {
    issues: securityIssues,
    riskLevel: securityIssues.length > 0 ? 'high' : 'low'
  };
}

// 综合分析报告生成
function generatePythonAnalysisSummary(analyses: any): string {
  let summary = `## Python代码深度分析报告\n\n`;
  
  summary += `### 安全性评估\n状态: **${analyses.securityAnalysis.status.toUpperCase()}**\n`;
  if (analyses.securityAnalysis.issues.length > 0) {
    summary += `发现 ${analyses.securityAnalysis.issues.length} 个安全问题\n`;
  }
  summary += `\n`;
  
  summary += `### 代码结构\n`;
  summary += `- 总行数: ${analyses.structureAnalysis.totalLines}\n`;
  summary += `- 函数数量: ${analyses.structureAnalysis.functions.count}\n`;
  summary += `- 复杂度: ${analyses.complexityAnalysis.complexityLevel}\n\n`;
  
  summary += `### 业务价值\n价值评估: **${analyses.businessLogicAnalysis.businessValue.toUpperCase()}**\n`;
  if (analyses.businessLogicAnalysis.detectedDomains.length > 0) {
    summary += `检测到领域: ${analyses.businessLogicAnalysis.detectedDomains.map(d => d.domain).join(', ')}\n`;
  }
  
  return summary;
}

function generateJSONAnalysisSummary(data: any, structure: any): string {
  return `## JSON数据深度分析报告\n\n` +
         `### 数据结构\n` +
         `- 类型: ${structure.type}\n` +
         `- 层次深度: ${structure.depth}\n` +
         `- 数据大小: ${(structure.size / 1024).toFixed(2)} KB\n\n`;
}

function generateCSVAnalysisSummary(headers: string[], rows: string[][], analysis: any): string {
  return `## CSV数据深度分析报告\n\n` +
         `### 数据概览\n` +
         `- 数据行数: ${rows.length}\n` +
         `- 字段数量: ${headers.length}\n` +
         `- 估算内存使用: ${(analysis.estimatedMemory / 1024 / 1024).toFixed(2)} MB\n\n`;
}

function generateYAMLAnalysisSummary(structure: any, config: any): string {
  return `## YAML配置深度分析报告\n\n` +
         `### 结构信息\n` +
         `- 配置章节: ${structure.sections}\n` +
         `- 检测配置类型: ${config.detectedConfigs.join(', ') || '无'}\n\n`;
}

function estimateCSVMemoryUsage(headers: string[], rows: string[][]): number {
  const avgRowSize = rows.length > 0 ? 
    rows.reduce((acc, row) => acc + row.join(',').length, 0) / rows.length : 0;
  return avgRowSize * rows.length;
}
