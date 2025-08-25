import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('缺少Supabase配置信息');
}

// 创建Supabase客户端并确保会话持久化
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});

// Demo模式检查
export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === 'true';
}

// 检查用户登录状态
export async function getCurrentUser() {
  // 如果是demo模式，创建一个模拟用户
  if (isDemoMode()) {
    return {
      id: 'demo-user',
      email: 'demo@example.com',
      role: 'demo-user',
      app_metadata: {},
      user_metadata: {},
      aud: 'demo',
      created_at: '2025-08-21T00:00:00Z'
    };
  }
  
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    console.error('获取用户信息失败:', error);
    return null;
  }
  return user;
}

// 登录函数
export async function signIn(email: string, password: string) {
  return await supabase.auth.signInWithPassword({ email, password });
}

// 登出函数
export async function signOut() {
  return await supabase.auth.signOut();
}

// 在demo模式下请求财务指标数据
export async function getDemoFinancialIndicators() {
  return [
    // 一利五率卡片（利润总额、ROE、现金比率、资产负债率、研发强度、劳动生产率）
    {
      id: '1',
      name: '利润总额',
      code: 'TOTAL_PROFIT',
      value: 568.3,
      previousValue: 489.5,
      targetValue: 600.0,
      unit: '亿元',
      category: '一利五率',
      questions: ['利润增长的主要来源？', '各板块利润贡献占比？']
    },
    {
      id: '2',
      name: 'ROE',
      code: 'ROE',
      value: 18.2,
      previousValue: 16.8,
      targetValue: 20.0,
      unit: '%',
      category: '一利五率',
      questions: ['股东权益变化情况？', '如何提高ROE水平？']
    },
    {
      id: '3',
      name: '现金比率',
      code: 'CASH_RATIO',
      value: 0.35,
      previousValue: 0.28,
      targetValue: 0.40,
      unit: '',
      category: '一利五率',
      questions: ['现金状况是否健康？', '如何提高现金比率？']
    },
    {
      id: '4',
      name: '资产负债率',
      code: 'DEBT_RATIO',
      value: 54.3,
      previousValue: 58.7,
      targetValue: 50.0,
      unit: '%',
      category: '一利五率',
      questions: ['负债结构是否合理？', '如何优化资本结构？']
    },
    {
      id: '5',
      name: '研发强度',
      code: 'RD_INTENSITY',
      value: 6.2,
      previousValue: 5.1,
      targetValue: 8.0,
      unit: '%',
      category: '一利五率',
      questions: ['研发方向是什么？', '投入产出比如何？']
    },
    {
      id: '6',
      name: '劳动生产率',
      code: 'LABOR_PRODUCTIVITY',
      value: 89.6,
      previousValue: 78.2,
      targetValue: 95.0,
      unit: '万元/人',
      category: '一利五率',
      questions: ['人效如何提升？', '各板块劳动生产率对比？']
    },
    
    // 盈利能力卡片（毛利率，净利率等）
    {
      id: '7',
      name: '毛利率',
      code: 'GROSS_MARGIN',
      value: 28.5,
      previousValue: 26.2,
      targetValue: 30.0,
      unit: '%',
      category: '盈利能力',
      questions: ['哪个子公司拖后腿？', '成本上升的主要原因？']
    },
    {
      id: '8',
      name: '净利率',
      code: 'NET_MARGIN',
      value: 12.8,
      previousValue: 10.5,
      targetValue: 15.0,
      unit: '%',
      category: '盈利能力',
      questions: ['哪个板块贡献最大？', '与同行业对比如何？']
    },
    {
      id: '9',
      name: 'ROA',
      code: 'ROA',
      value: 7.5,
      previousValue: 6.2,
      targetValue: 9.0,
      unit: '%',
      category: '盈利能力',
      questions: ['资产效率如何提升？', '各板块资产收益率比较']
    },
    {
      id: '10',
      name: 'EBITDA利润率',
      code: 'EBITDA_MARGIN',
      value: 22.8,
      previousValue: 20.5,
      targetValue: 25.0,
      unit: '%',
      category: '盈利能力',
      questions: ['各业务EBITDA贡献？', '同比变化原因？']
    },
    
    // 营运能力卡片（总资产周转率，应收账款周转率）
    {
      id: '11',
      name: '总资产周转率',
      code: 'ASSET_TURNOVER',
      value: 0.65,
      previousValue: 0.58,
      targetValue: 0.75,
      unit: '次/年',
      category: '营运能力',
      questions: ['资产使用效率如何？', '闲置资产状况？']
    },
    {
      id: '12',
      name: '应收账款周转率',
      code: 'RECEIVABLES_TURNOVER',
      value: 8.5,
      previousValue: 7.8,
      targetValue: 10.0,
      unit: '次/年',
      category: '营运能力',
      questions: ['账款回收情况如何？', '大客户账期情况？']
    },
    {
      id: '13',
      name: '存货周转率',
      code: 'INVENTORY_TURNOVER',
      value: 6.8,
      previousValue: 6.2,
      targetValue: 8.0,
      unit: '次/年',
      category: '营运能力',
      questions: ['库存结构合理吗？', '周转率提升空间？']
    },
    
    // 偿债能力卡片（流动比率，速动比率）
    {
      id: '14',
      name: '流动比率',
      code: 'CURRENT_RATIO',
      value: 1.8,
      previousValue: 1.5,
      targetValue: 2.0,
      unit: '',
      category: '偿债能力',
      questions: ['短期偿债压力大吗？', '流动资产结构如何？']
    },
    {
      id: '15',
      name: '速动比率',
      code: 'QUICK_RATIO',
      value: 1.2,
      previousValue: 0.9,
      targetValue: 1.5,
      unit: '',
      category: '偿债能力',
      questions: ['即时偿债能力如何？', '与行业标准比较？']
    },
    {
      id: '16',
      name: '利息保障倍数',
      code: 'INTEREST_COVERAGE',
      value: 5.8,
      previousValue: 4.5,
      targetValue: 7.0,
      unit: '倍',
      category: '偿债能力',
      questions: ['利息负担情况？', '财务成本优化建议？']
    },
    
    // 发展能力卡片（营业收入增长率，净利润增长率）
    {
      id: '17',
      name: '营业收入增长率',
      code: 'REVENUE_GROWTH',
      value: 15.3,
      previousValue: 12.1,
      targetValue: 18.0,
      unit: '%',
      category: '发展能力',
      questions: ['增长点在哪里？', '可持续性如何？']
    },
    {
      id: '18',
      name: '净利润增长率',
      code: 'NET_PROFIT_GROWTH',
      value: 18.5,
      previousValue: 14.8,
      targetValue: 20.0,
      unit: '%',
      category: '发展能力',
      questions: ['高于收入增长的原因？', '未来增长预测？']
    },
    {
      id: '19',
      name: '总资产增长率',
      code: 'ASSET_GROWTH',
      value: 10.2,
      previousValue: 8.5,
      targetValue: 12.0,
      unit: '%',
      category: '发展能力',
      questions: ['资产扩张合理吗？', '主要投资方向？']
    },
    
    // 现金流卡片（经营活动现金流，自由现金流）
    {
      id: '20',
      name: '经营活动现金流',
      code: 'OPERATING_CASH_FLOW',
      value: 482.5,
      previousValue: 420.8,
      targetValue: 550.0,
      unit: '亿元',
      category: '现金流',
      questions: ['现金流健康吗？', '经营活动现金流变动原因？']
    },
    {
      id: '21',
      name: '自由现金流',
      code: 'FREE_CASH_FLOW',
      value: 215.6,
      previousValue: 175.2,
      targetValue: 250.0,
      unit: '亿元',
      category: '现金流',
      questions: ['自由现金流用途？', '分红政策是否合理？']
    },
    {
      id: '22',
      name: '现金流量比率',
      code: 'CASH_FLOW_RATIO',
      value: 0.85,
      previousValue: 0.76,
      targetValue: 1.0,
      unit: '',
      category: '现金流',
      questions: ['现金流与利润匹配度？', '运营效率改善建议？']
    }
  ];
}

// 在demo模式下请求政策动态数据
export async function getDemoPolicyNews() {
  return [
    {
      id: '1',
      title: '国家发改委：加快数字经济立法进程',
      category: '产业政策',
      industry: '宏观综合',
      summary: '发改委表示将加快数字经济相关立法，推动数字经济健康发展，预计未来三年将有一系列支持政策出台。',
      publishDate: '2025-08-15',
      source: '国家发改委',
      impact: '积极',
      content: '国家发改委发布《关于加快数字经济发展的指导意见》，提出到2027年，数字经济核心产业增加值占GDP比重达到12%，数字经济发展环境持续优化。意见指出，将加快推进数字经济相关法律法规建设，完善数据要素市场化配置机制，强化关键核心技术创新，构建现代化数字产业体系。对相关企业的扶持政策包括税收优惠、专项资金支持等多项措施。',
      url: 'https://example.com/news/1'
    },
    {
      id: '2',
      title: '央行：稳步推进数字人民币试点',
      category: '金融政策',
      industry: '金融',
      summary: '央行表示将进一步扩大数字人民币试点范围，预计年底前覆盖全国所有省会城市，支持金融科技创新。',
      publishDate: '2025-08-10',
      source: '中国人民银行',
      impact: '中性',
      content: '中国人民银行发布《数字人民币试点进展白皮书》，宣布已在10个省市开展数字人民币试点，累计交易金额超过500亿元。央行表示，将在年底前将试点范围扩大至所有省会城市，并探索更多应用场景。同时，央行强调数字人民币与第三方支付平台是互补关系，将进一步深化与金融科技企业的合作，共同推动支付体系创新发展。',
      url: 'https://example.com/news/2'
    },
    {
      id: '3',
      title: '多部门联合发布《国家综合立体交通网规划纲要》',
      category: '交通物流',
      industry: '交通',
      summary: '交通部等七部门联合发布规划纲要，提出建设高效率国家综合立体交通网，加强港口智能化升级。',
      publishDate: '2025-08-05',
      source: '交通运输部',
      impact: '积极',
      content: '交通运输部、发改委等七部门联合发布《国家综合立体交通网规划纲要（2025-2035年）》，提出打造高效率现代化交通网络的战略目标。规划特别强调了港口智能化、绿色化升级的重要性，提出到2030年，沿海主要港口全面实现智能化、无人化运营，港口综合效率提升30%以上。规划还明确了对交通物流重点项目的资金支持和政策倾斜，预计将有超过2万亿元资金投入相关建设。',
      url: 'https://example.com/news/3'
    },
    {
      id: '4',
      title: '国务院：支持长三角一体化发展，打造世界级港口群',
      category: '区域政策',
      industry: '港口',
      summary: '国务院发文支持长三角一体化高质量发展，提出打造世界级港口群和航运中心，推动区域协同发展。',
      publishDate: '2025-07-30',
      source: '国务院',
      impact: '积极',
      content: '国务院印发《关于支持长三角一体化高质量发展的指导意见》，明确提出支持上海、宁波舟山、连云港等港口协同发展，打造世界级港口群。意见强调，将加大对港口智能化、绿色化改造的财政支持力度，推动港航资源优化配置，建立区域港口协调发展机制。同时，将优化沿海产业布局，促进港产城融合发展，培育壮大海洋经济。预计到2030年，长三角地区港口群年吞吐量将达到50亿吨，集装箱吞吐量超过1.5亿标准箱。',
      url: 'https://example.com/news/4'
    },
    {
      id: '5',
      title: '财政部：扩大基础设施REITs试点范围',
      category: '金融政策',
      industry: '金融',
      summary: '财政部、证监会联合发文扩大基础设施REITs试点范围，将港口、高速公路等纳入支持范围，盘活存量资产。',
      publishDate: '2025-07-25',
      source: '财政部',
      impact: '积极',
      content: '财政部与证监会联合发布《关于进一步扩大基础设施领域不动产投资信托基金（REITs）试点范围的通知》，将港口、航运、高速公路等交通基础设施正式纳入REITs试点支持范围。通知明确，支持优质成熟的港口码头资产发行REITs，盘活存量资产，形成投资良性循环。同时，明确了港口类REITs的准入标准、运营要求等细则，预计首批港口REITs项目将于今年四季度获批。业内预计，此举将为港口企业带来千亿级融资机会，显著降低企业负债率。',
      url: 'https://example.com/news/5'
    }
  ];
}

// 在demo模式下请求子公司数据
export async function getDemoSubsidiaries() {
  return [
    {
      id: 1,
      name: '集团总部',
      sector_id: 4,
      parent_id: null,
      level: 1
    },
    {
      id: 2,
      name: '金融事业部',
      sector_id: 1,
      parent_id: 1,
      level: 2
    },
    {
      id: 3,
      name: '港口事业部',
      sector_id: 2,
      parent_id: 1,
      level: 2
    },
    {
      id: 4,
      name: '地产事业部',
      sector_id: 3,
      parent_id: 1,
      level: 2
    },
    {
      id: 5,
      name: '上海分公司',
      sector_id: 1,
      parent_id: 2,
      level: 3
    },
    {
      id: 6,
      name: '深圳分公司',
      sector_id: 1,
      parent_id: 2,
      level: 3
    }
  ];
}

// 在demo模式下请求板块数据
export async function getDemoSectors() {
  return [
    {
      id: 1,
      name: '金融事业',
      code: 'FINANCE',
      description: '银行、保险、证券等金融服务业务',
      color: '#3B82F6'
    },
    {
      id: 2,
      name: '港口事业',
      code: 'PORT',
      description: '港口运营、物流服务等业务',
      color: '#10B981'
    },
    {
      id: 3,
      name: '地产事业',
      code: 'REALESTATE',
      description: '房地产开发、物业管理等业务',
      color: '#F59E0B'
    },
    {
      id: 4,
      name: '综合管理',
      code: 'CORPORATE',
      description: '集团综合管理和支持服务',
      color: '#8B5CF6'
    }
  ];
}
