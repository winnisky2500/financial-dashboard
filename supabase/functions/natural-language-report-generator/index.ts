// Natural Language Report Generator Edge Function
// 处理基于自然语言描述的智能报告生成

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
    const { naturalLanguageDescription, reportContext, userPreferences } = requestData;

    // 验证输入
    if (!naturalLanguageDescription || naturalLanguageDescription.trim().length < 10) {
      return new Response(JSON.stringify({ 
        error: { 
          code: 'INVALID_INPUT', 
          message: '请提供详细的报告需求描述（至少10个字符）' 
        } 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 分析用户需求
    const analysisResult = await analyzeReportRequirements(naturalLanguageDescription);
    
    // 生成报告结构
    const reportStructure = await generateReportStructure(analysisResult);
    
    // 生成报告内容
    const reportContent = await generateReportContent(reportStructure, reportContext);
    
    // 生成元数据
    const metadata = {
      generatedAt: new Date().toISOString(),
      analysisResult,
      reportStructure,
      estimatedReadingTime: Math.ceil(reportContent.length / 1000) + ' 分钟',
      wordCount: reportContent.split(/\s+/).length,
      sections: reportStructure.sections.length
    };

    const response = {
      success: true,
      reportContent,
      metadata,
      originalRequest: naturalLanguageDescription,
      suggestions: await generateFollowUpSuggestions(analysisResult)
    };

    return new Response(JSON.stringify({ data: response }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Natural language report generation error:', error);
    
    const errorResponse = {
      error: {
        code: 'GENERATION_ERROR',
        message: error.message || '报告生成过程中发生错误'
      }
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// 分析报告需求
async function analyzeReportRequirements(description: string) {
  // 提取关键信息
  const keywordPatterns = {
    reportType: {
      quarterly: /季度|季报|Q[1-4]/gi,
      annual: /年度|年报|全年/gi,
      monthly: /月度|月报/gi,
      risk: /风险|风控|评估/gi,
      esg: /ESG|可持续|环境|社会责任/gi,
      investor: /投资者|股东|IR/gi
    },
    timeframe: {
      current: /本|当前|这个/gi,
      q1: /Q1|第一季度|一季度/gi,
      q2: /Q2|第二季度|二季度/gi,
      q3: /Q3|第三季度|三季度/gi,
      q4: /Q4|第四季度|四季度/gi,
      year2024: /2024/gi,
      year2025: /2025/gi
    },
    focus: {
      revenue: /收入|营收|销售/gi,
      profit: /利润|盈利/gi,
      cashflow: /现金流|资金/gi,
      growth: /增长|发展/gi,
      comparison: /对比|比较|同比|环比/gi,
      forecast: /预测|预期|展望/gi,
      risk: /风险|挑战/gi,
      market: /市场|行业/gi
    }
  };

  const analysis = {
    reportType: 'general',
    timeframe: 'current',
    focusAreas: [],
    complexity: 'medium',
    urgency: 'normal',
    estimatedLength: 'medium'
  };

  // 分析报告类型
  for (const [type, pattern] of Object.entries(keywordPatterns.reportType)) {
    if (pattern.test(description)) {
      analysis.reportType = type;
      break;
    }
  }

  // 分析时间范围
  for (const [time, pattern] of Object.entries(keywordPatterns.timeframe)) {
    if (pattern.test(description)) {
      analysis.timeframe = time;
      break;
    }
  }

  // 分析关注重点
  for (const [focus, pattern] of Object.entries(keywordPatterns.focus)) {
    if (pattern.test(description)) {
      analysis.focusAreas.push(focus);
    }
  }

  // 分析复杂度
  const complexityIndicators = {
    high: /详细|深入|全面|综合|复杂/gi,
    low: /简单|概览|摘要|简要/gi
  };

  if (complexityIndicators.high.test(description)) {
    analysis.complexity = 'high';
  } else if (complexityIndicators.low.test(description)) {
    analysis.complexity = 'low';
  }

  // 估算长度
  if (description.length > 200) {
    analysis.estimatedLength = 'long';
  } else if (description.length < 50) {
    analysis.estimatedLength = 'short';
  }

  return analysis;
}

// 生成报告结构
async function generateReportStructure(analysis: any) {
  const baseStructures = {
    quarterly: {
      title: '季度财务分析报告',
      sections: [
        { id: 'executive_summary', title: '执行摘要', required: true },
        { id: 'financial_highlights', title: '财务亮点', required: true },
        { id: 'revenue_analysis', title: '收入分析', required: true },
        { id: 'profitability', title: '盈利能力分析', required: true },
        { id: 'cashflow', title: '现金流分析', required: true },
        { id: 'comparison', title: '同比环比分析', required: false },
        { id: 'outlook', title: '展望与预测', required: false }
      ]
    },
    annual: {
      title: '年度财务报告',
      sections: [
        { id: 'executive_summary', title: '管理层讨论与分析', required: true },
        { id: 'business_overview', title: '业务概览', required: true },
        { id: 'financial_performance', title: '财务表现', required: true },
        { id: 'operational_metrics', title: '运营指标', required: true },
        { id: 'risk_factors', title: '风险因素', required: true },
        { id: 'strategy', title: '发展战略', required: false },
        { id: 'sustainability', title: '可持续发展', required: false }
      ]
    },
    risk: {
      title: '风险评估报告',
      sections: [
        { id: 'risk_summary', title: '风险概述', required: true },
        { id: 'market_risk', title: '市场风险', required: true },
        { id: 'credit_risk', title: '信用风险', required: true },
        { id: 'operational_risk', title: '运营风险', required: true },
        { id: 'mitigation', title: '风险缓解措施', required: true },
        { id: 'monitoring', title: '风险监控', required: false }
      ]
    },
    general: {
      title: '财务分析报告',
      sections: [
        { id: 'overview', title: '概述', required: true },
        { id: 'analysis', title: '详细分析', required: true },
        { id: 'findings', title: '主要发现', required: true },
        { id: 'recommendations', title: '建议', required: true }
      ]
    }
  };

  let structure = baseStructures[analysis.reportType] || baseStructures.general;

  // 根据关注重点调整结构
  if (analysis.focusAreas.includes('forecast')) {
    structure.sections.push({ id: 'forecast', title: '预测分析', required: true });
  }

  if (analysis.focusAreas.includes('comparison')) {
    structure.sections.push({ id: 'benchmark', title: '行业对比', required: true });
  }

  // 根据复杂度调整
  if (analysis.complexity === 'low') {
    structure.sections = structure.sections.filter(s => s.required);
  }

  return structure;
}

// 生成报告内容
async function generateReportContent(structure: any, context: any) {
  let content = `# ${structure.title}\n\n`;
  
  content += `> **报告生成时间**: ${new Date().toLocaleDateString('zh-CN')}\n`;
  content += `> **报告类型**: ${structure.title}\n\n`;

  for (const section of structure.sections) {
    content += `## ${section.title}\n\n`;
    content += await generateSectionContent(section.id, context);
    content += '\n\n';
  }

  content += `---\n\n`;
  content += `**声明**: 本报告由AI智能生成，仅供参考。实际决策请结合具体业务情况和专业判断。\n`;

  return content;
}

// 生成章节内容
async function generateSectionContent(sectionId: string, context: any) {
  const sectionTemplates = {
    executive_summary: `本报告期内，公司整体财务表现稳健，主要财务指标符合预期。\n\n**关键亮点:**\n- 营业收入同比增长，显示良好的市场表现\n- 盈利能力保持稳定，运营效率持续优化\n- 现金流状况良好，为未来发展提供有力支撑\n\n**主要挑战:**\n- 市场竞争加剧，需要持续创新保持优势\n- 成本控制压力增大，需要进一步提升运营效率`,
    
    financial_highlights: `### 核心财务数据\n\n| 指标 | 本期 | 上期 | 变化 |\n|------|------|------|------|\n| 营业收入 | - | - | - |\n| 净利润 | - | - | - |\n| 总资产 | - | - | - |\n| 净资产 | - | - | - |\n\n*注: 具体数据需要根据实际财务报表填入*`,
    
    revenue_analysis: `营业收入分析显示，公司在报告期内保持了稳定的增长态势。\n\n**收入构成分析:**\n- 主营业务收入占比约X%，为公司收入的主要来源\n- 其他业务收入贡献X%，多元化经营初见成效\n\n**增长驱动因素:**\n- 市场需求增长\n- 产品结构优化\n- 销售渠道拓展`,
    
    profitability: `盈利能力分析表明，公司在保持收入增长的同时，有效控制了成本费用。\n\n**关键盈利指标:**\n- 毛利率: 保持在合理水平\n- 净利率: 显示良好的成本控制能力\n- ROE: 反映出色的股东回报水平\n\n**盈利质量评估:**\n盈利结构合理，现金流量与利润匹配良好。`,
    
    cashflow: `现金流分析显示，公司现金流管理能力强，流动性充足。\n\n**现金流构成:**\n- 经营活动现金流: 主营业务产生稳定现金流入\n- 投资活动现金流: 反映公司战略投资和资本开支\n- 筹资活动现金流: 体现融资和分红政策\n\n**流动性评估:**\n公司现金及等价物充足，能够满足日常运营和发展需要。`,
    
    comparison: `通过同比和环比分析，可以更好地理解公司财务表现的趋势和周期性特征。\n\n**同比分析:**\n与去年同期相比，主要指标变化反映了公司的长期发展趋势。\n\n**环比分析:**\n与上季度相比，短期波动体现了季节性和周期性因素的影响。`,
    
    outlook: `基于当前财务状况和市场环境，对未来发展进行审慎预测。\n\n**发展机遇:**\n- 市场空间广阔，行业前景乐观\n- 公司核心竞争力持续增强\n- 技术创新带来新的增长点\n\n**潜在风险:**\n- 宏观经济不确定性\n- 行业竞争加剧\n- 成本上升压力\n\n**管理建议:**\n继续专注主营业务，加强成本控制，提升运营效率。`,
    
    overview: `本报告对公司财务状况进行全面分析，重点关注关键财务指标和经营表现。\n\n**分析框架:**\n- 财务数据的横向和纵向对比\n- 关键指标的趋势分析\n- 风险因素的识别和评估`,
    
    analysis: `通过深入分析财务数据，我们发现以下关键趋势和特征:\n\n**正面因素:**\n- 收入增长稳健\n- 成本控制有效\n- 现金流稳定\n\n**关注点:**\n- 某些费用项目增长较快\n- 应收账款周转需要关注\n- 市场竞争影响毛利率`,
    
    findings: `基于详细的财务分析，主要发现如下:\n\n1. **财务健康度良好**: 各项财务指标处于合理区间\n2. **增长质量较高**: 收入增长伴随盈利能力提升\n3. **风险控制有效**: 财务风险处于可控范围\n4. **运营效率提升**: 资产周转和费用控制显示管理改善`,
    
    recommendations: `基于分析结果，提出以下建议:\n\n**短期建议:**\n- 继续加强现金流管理\n- 优化成本结构\n- 提升运营效率\n\n**中长期建议:**\n- 投资核心业务能力建设\n- 探索新的增长机会\n- 完善风险管理体系`
  };

  return sectionTemplates[sectionId] || `本章节内容正在生成中，请稍后查看详细分析。`;
}

// 生成后续建议
async function generateFollowUpSuggestions(analysis: any) {
  const suggestions = [
    '添加更多图表和可视化分析',
    '进行行业对比分析',
    '深入分析特定业务板块',
    '增加风险评估章节',
    '添加管理层建议和战略规划'
  ];

  // 根据分析结果定制建议
  if (analysis.focusAreas.includes('forecast')) {
    suggestions.unshift('扩展预测分析的时间范围');
  }

  if (analysis.complexity === 'low') {
    suggestions.push('增加更多详细的财务指标分析');
  }

  return suggestions.slice(0, 3); // 返回前3个建议
}
