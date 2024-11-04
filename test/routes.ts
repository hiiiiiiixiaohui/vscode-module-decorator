/**
 * menus router config
 */
export default [
    {
        path: '/user',
        layout: false,
        routes: [
            {
                name: 'login',
                path: '/user/login',
                component: './user/login',
            },
        ],
    },
    {
        path: '/dashboard',
        name: '首页',
        icon: 'HomeOutlined',
        component: './Welcome',
    },
    {
        name: '系统总览',
        path: '/systemoverview',
        icon: 'dashboard',
        title: 'biz_systemOverview',
        access: 'hasRoute',
        component: './SystemOverview',
    },
    // 工作台
    {
        name: '工作台',
        icon: 'orderedList',
        path: '/todo',
        title: 'biz_todo',
        access: 'hasRoute',
        component: './Todo',
    },
    {
        name: '用户管理',
        icon: 'user',
        title: 'biz_userMng',
        access: 'hasRoute',
        path: '/userMng',
        routes: [
            {
                name: '企业用户',
                path: '/userMng/enterpriseMng',
                title: 'biz_userMng_enterpriseMng',
                access: 'hasRoute',
                routes: [
                    {
                        path: '/userMng/enterpriseMng/list',
                        name: '进件管理',
                        component: './EnterpriseIncoming',
                    },
                    {
                        path: '/userMng/enterpriseMng/detail',
                        name: '企业进件详情',
                        hideInMenu: true,
                        component: './EnterpriseIncoming/detail',
                    },
                    {
                        path: '/userMng/enterpriseMng/heavy-promote-detail',
                        name: '提额进件详情',
                        hideInMenu: true,
                        component: './EnterpriseIncoming/components/HeavyQuotaPromoteDetail',
                    },
                    {
                        path: '/userMng/enterpriseMng/com-list',
                        name: '额度管理',
                        component: './EnterpriseMng',
                    },
                    {
                        path: '/userMng/enterpriseMng/com-detail',
                        name: '企业用户详情',
                        hideInMenu: true,
                        component: './EnterpriseMng/com-detail',
                    },
                    {
                        path: '/userMng/enterpriseMng/product-detail',
                        name: '企业用户详情',
                        hideInMenu: true,
                        component: './EnterpriseMng/product-detail',
                    },
                    {
                        path: '/userMng/enterpriseMng/authentication/list',
                        name: '认证管理',
                        title: 'car_insurance_certification_management',
                        access: 'hasRoute',
                        component: './Authentication/list',
                    },
                    {
                        path: '/userMng/enterpriseMng/authentication/detail',
                        name: '认证管理-详情',
                        hideInMenu: true,
                        component: './Authentication/detail',
                    },
                    {
                        path: '/userMng/enterpriseMng/authentication/add',
                        name: '认证管理-新增',
                        hideInMenu: true,
                        component: './Authentication/add',
                    },
                ],
            },
            {
                name: '个人用户',
                path: '/userMng/personalMng',
                title: 'biz_userMng_personalMng',
                access: 'hasRoute',
                routes: [
                    {
                        path: '/userMng/personalMng/list',
                        name: '个人进件管理',
                        component: './PersonalIncoming',
                    },
                    {
                        path: '/userMng/personalMng/detail',
                        name: '个人进件详情',
                        hideInMenu: true,
                        component: './PersonalIncoming/detail',
                    },
                    {
                        path: '/userMng/personalMng/com-list',
                        name: '个人用户管理',
                        component: './PersonalMng',
                    },
                    {
                        path: '/userMng/personalMng/com-detail',
                        name: '个人用户详情',
                        hideInMenu: true,
                        component: './PersonalMng/detail',
                    },
                ],
            },
        ],
    },

    {
        name: '业务管理',
        icon: 'snippets',
        path: '/businessMng',
        title: 'biz_businessMng',
        access: 'hasRoute',
        routes: [
            {
                path: '/businessMng/car-insurance/list',
                name: '订单管理(车险分期)',
                title: 'car_insurance_list',
                access: 'hasRoute',
                component: './CarInsurance/list',
            },
            {
                path: '/businessMng/car-insurance/detail',
                name: '订单详情(车险分期)',
                hideInMenu: true,
                title: '',
                component: './CarInsurance/detail',
            },
            {
                path: '/businessMng/list',
                name: '订单管理(账期)',
                component: './BusinessMng',
                title: 'biz_businessMng_list',
                access: 'hasRoute',
            },
            {
                path: '/businessMng/detail',
                name: '订单详情(账期)',
                hideInMenu: true,
                component: './BusinessMng/order-detail',
            },
            {
                path: '/businessMng/lease-list',
                name: '订单管理(融租)',
                component: './BusinessLeaseMng',
                title: 'biz_businessMng_leaseList',
                access: 'hasRoute',
            },
            {
                path: '/businessMng/lease-detail',
                name: '订单详情(融租)',
                hideInMenu: true,
                component: './BusinessLeaseMng/lease-order-detail',
            },
            {
                path: '/businessMng/lease-come',
                name: '申请进件',
                hideInMenu: true,
                component: './BusinessLeaseMng/lease-come-form',
            },
            {
                path: '/businessMng/cash-list',
                name: '订单管理(小贷)',
                title: 'biz_businessMng_cashList',
                component: './BusinessCashMng',
                access: 'hasRoute',
            },
            {
                path: '/businessMng/cash-detail',
                name: '订单详情(小贷)',
                hideInMenu: true,
                component: './BusinessCashMng/cash-order-detail',
            },
            {
                path: '/businessMng/loan-list',
                name: '放款管理',
                component: './Loan',
                title: 'biz_businessMng_loanList',
                access: 'hasRoute',
            },
            {
                path: '/businessMng/loan-car-detail',
                name: '放款详情 - 车险分期',
                hideInMenu: true,
                component: './Loan/loan-car-detail',
            },
            {
                path: '/businessMng/loan-detail',
                name: '放款详情',
                hideInMenu: true,
                component: './Loan/loan-detail',
            },
            {
                path: '/businessMng/loan-lease-detail',
                name: '放款详情',
                hideInMenu: true,
                component: './Loan/loan-lease-detail',
                title: 'biz_businessMng_loan_lease_detail',
                access: 'hasRoute',
                // 融租 业务系统_放款详情
            },
            {
                path: '/businessMng/loan-cash-detail',
                name: '放款详情',
                hideInMenu: true,
                component: './Loan/loan-cash-detail',
            },
            {
                path: '/businessMng/postLoanMng',
                name: '贷后管理',
                title: 'biz_businessMng_postLoanMng',
                access: 'hasRoute',
                // component: './Loan',
                routes: [
                    {
                        path: '/businessMng/postLoanMng/mailList',
                        name: '邮件发送记录',
                        title: 'biz_businessMng_postLoanMng_mailList',
                        access: 'hasRoute',
                        component: './MailList',
                    },
                    {
                        path: '/businessMng/postLoanMng/reconciliation',
                        name: '调账管理',
                        access: 'hasRoute',
                        title: 'reconciliation',
                        component: './Reconciliation',
                    },
                    {
                        path: '/businessMng/postLoanMng/after-loan-list',
                        name: '还款管理',
                        component: './AfterLoan',
                        access: 'hasRoute',
                        title: 'biz_businessMng_postLoanMng_afterLoanList',
                    },
                    // {
                    //   path: '/businessMng/postLoanMng/after-loan-list',
                    //   name: '还款管理 - 车险',
                    //   component: './AfterLoan',
                    // },
                    {
                        path: '/businessMng/postLoanMng/car-insurance/list',
                        name: '还款管理 - 车险',
                        hideInMenu: true,
                        title: 'car_insurance_repayment_management',
                        access: 'hasRoute',
                        component: './AfterLoanCarInsurance/list',
                    },
                    {
                        path: '/businessMng/postLoanMng/car-insurance/detail',
                        name: '还款管理 - 详情',
                        hideInMenu: true,
                        component: './AfterLoanCarInsurance/detail',
                    },
                    {
                        path: '/businessMng/postLoanMng/repay-detail',
                        name: '还款明细',
                        hideInMenu: true,
                        component: './AfterLoan/repay-detail',
                    },
                    {
                        path: '/businessMng/postLoanMng/after-loan-detail',
                        name: '还款详情',
                        hideInMenu: true,
                        component: './AfterLoan/after-loan-detail',
                    },
                    {
                        path: '/businessMng/postLoanMng/overdue',
                        name: '逾期管理',
                        component: './Overdue',
                        title: 'biz_businessMng_postLoanMng_overdueMng',
                        access: 'hasRoute',
                    },
                    {
                        path: '/businessMng/postLoanMng/overdue-detail',
                        name: '逾期详情',
                        hideInMenu: true,
                        component: './Overdue/detail',
                        title: 'biz_businessMng_postLoanMng_overdueDetail',
                        access: 'hasRoute',
                    },
                    {
                        path: '/businessMng/postLoanMng/overdue-lease-detail', // 融租的逾期详情
                        name: '逾期详情',
                        hideInMenu: true,
                        component: './Overdue/lease-detail',
                        title: 'biz_businessMng_postLoanMng_overdueLeaseDetail',
                        access: 'hasRoute',
                    },
                    {
                        path: '/businessMng/postLoanMng/collection',
                        name: '催收管理',
                        access: 'hasRoute',
                        title: 'overdueCase_list',
                        component: './Collection',
                    },
                    {
                        path: '/businessMng/postLoanMng/collection-detail',
                        name: '催收案件详情',
                        hideInMenu: true,
                        component: './Collection/detail',
                        title: 'biz_businessMng_postLoanMng_collectionDetail',
                        access: 'hasRoute',
                    },
                    {
                        path: '/businessMng/postLoanMng/callpay',
                        name: '回款审核',
                        component: './CallPay',
                        title: 'biz_businessMng_postLoanMng_callpay',
                        access: 'hasRoute',
                    },
                    {
                        path: '/businessMng/postLoanMng/early-end-pay',
                        name: '提前结清',
                        hideInMenu: true,
                        component: './EarlyEndPay',
                    },
                    {
                        path: '/businessMng/postLoanMng/early-end-detail',
                        name: '提前结清详情',
                        hideInMenu: true,
                        component: './EarlyEndPay/early-end-detail',
                    },
                    // {
                    //   path: '/businessMng/postLoanMng/after-loan-detail',
                    //   name: '还款详情',
                    //   hideInMenu: true,
                    //   component: './AfterLoan/after-loan-detail',
                    // },
                    {
                        path: '/businessMng/postLoanMng/collect',
                        name: '减免审核',
                        component: './CollectRelief',
                        access: 'hasRoute',
                        title: 'biz_businessMng_postLoanMng_collect',
                    },
                    {
                        path: '/businessMng/postLoanMng/withhold',
                        name: '逾期配置',
                        component: './WithHold',
                        access: 'hasRoute',
                        title: 'biz_businessMng_postLoanMng_withhold',
                    },
                    {
                        path: '/businessMng/postLoanMng/withhold-detail',
                        name: '逾期配置详情',
                        hideInMenu: true,
                        component: './WithHold/detail',
                    },
                    // {
                    //   path: '/businessMng/postLoanMng/after-loan-detail',
                    //   name: '还款详情',
                    //   hideInMenu: true,
                    //   component: './AfterLoan/after-loan-detail',
                    // },
                    {
                        path: '/businessMng/postLoanMng/call-out-list',
                        name: '外呼记录',
                        component: './CallOutMng',
                        title: 'biz_businessMng_postLoanMng_callOutList',
                        access: 'hasRoute',
                    },
                    {
                        path: '/businessMng/postLoanMng/sms-manual-list',
                        name: '手动催收短信记录',
                        component: './SmsRecordMsg',
                        access: 'hasRoute',
                        title: 'biz_businessMng_postLoanMng_smsManualList',
                    },
                ],
            },

            {
                path: '/businessMng/bill-list',
                name: '账单管理',
                component: './Bill',
                title: 'biz_businessMng_billList',
                access: 'hasRoute',
            },
            {
                path: '/businessMng/bill-detail',
                name: '账单详情',
                hideInMenu: true,
                component: './Bill/bill-detail',
            },
            {
                path: '/businessMng/debt-list',
                name: '债权转让',
                component: './Debt',
                title: 'biz_businessMng_debtList',
                access: 'hasRoute',
            },
            {
                path: '/businessMng/debt-detail',
                name: '债权转让详情',
                hideInMenu: true,
                component: './Debt/debt-detail',
            },
            {
                path: '/businessMng/product-list',
                name: '产品管理',
                component: './Product',
                title: 'biz_businessMng_productList',
                access: 'hasRoute',
                // routes: [

                // ],
            },
            {
                path: '/businessMng/draft-list',
                name: '草稿箱',
                hideInMenu: true,
                component: './Product/product-draft-list',
            },
            {
                path: '/businessMng/add-product',
                name: '创建产品',
                hideInMenu: true,
                component: './Product/add-product',
            },
            {
                path: '/businessMng/product-bill-detail',
                name: '产品详情(账期)',
                hideInMenu: true,
                component: './Product/product-bill-detail',
            },
            {
                path: '/businessMng/product-lease-detail',
                name: '产品详情(融租)',
                hideInMenu: true,
                component: './Product/product-lease-detail',
            },
            {
                path: '/businessMng/product-cash-detail',
                name: '产品详情(小贷)',
                hideInMenu: true,
                component: './Product/product-cash-detail',
            },
            // {
            //   path: '*',
            //   name: '页面路径错误',
            //   hideInMenu: true,
            //   component: './404',
            // },
        ],
    },
    {
        icon: 'userDelete',
        name: '运营管理',
        path: '/operation-manager',
        title: 'operate_manage',
        access: 'hasRoute',
        routes: [
            {
                path: '/operation-manager/business-report',
                name: '小额贷款业务报表',
                title: 'gdjr_data_report',
                component: './BusinessExcel',
                access: 'hasRoute',
            },
            {
                path: '/operation-manager/first-audit',
                name: '应收账款风控预跑',
                title: 'debt_risk_pre',
                access: 'hasRoute',
                component: './FirstAudit',
            },
            {
                path: '/operation-manager/first-audit/detail',
                name: '应收账款风控预跑详情',
                hideInMenu: true,
                component: './FirstAudit/detail',
            },
            {
                path: '/operation-manager/risk-run',
                name: '明保风控预跑',
                title: 'risk_pre',
                access: 'hasRoute',
                component: './RiskPreRun',
            },
            {
                name: '运营配置',
                path: '/operation-manager/operate-config',
                title: 'operation_configuration_list_operate_manage',
                access: 'hasRoute',
                component: './OperateConfig',
            },
            {
                name: '大额提额配置列表',
                path: '/operation-manager/operate-config/increase-detail',
                // title:'',
                // access:'hasRoute',
                hideInMenu: true,
                component: './IncreaseDetail',
            },
            {
                name: '应收账款风控预跑白名单',
                path: '/operation-manager/operate-config/prerisk-whitelist',
                // title:'',
                // access:'hasRoute',
                hideInMenu: true,
                component: './PreriskWhiteList',
            },
            {
                name: '主次账号',
                path: '/operation-manager/operate-config/primary-secondary-accounts',
                // title:'',
                // access:'hasRoute',
                hideInMenu: true,
                component: './PrimarySecondaryAccounts',
            },
            {
                name: '高额白名单',
                path: '/operation-manager/operate-config/heavy-quota-whitelist',
                // title:'',
                // access:'hasRoute',
                hideInMenu: true,
                component: './HeavyQuotaWhiteList',
            },

            {
                path: '/operation-manager/risk-run/detail',
                name: '保理进件名单',
                title: 'risk_pre_detail',
                hideInMenu: true,
                // access: 'hasRoute',
                component: './RiskPreRun/detail',
            },
            {
                path: '/operation-manager/channel',
                name: '融租渠道管理',
                title: 'biz_channel',
                access: 'hasRoute',
                routes: [
                    {
                        path: '/operation-manager/channel/channel-config',
                        name: '渠道配置',
                        component: './Channel',
                        title: 'biz_channel_config',
                        access: 'hasRoute',
                    },
                    {
                        path: '/operation-manager/channel/channel-detail',
                        name: '渠道信息配置',
                        hideInMenu: true,
                        component: './Channel/components/ConfigChannel',
                    },
                    {
                        path: '/operation-manager/channel/product-launch',
                        name: '产品投放',
                        component: './ProductLaunch',
                        title: 'biz_productLaunch',
                        access: 'hasRoute',
                    },
                    {
                        path: '/operation-manager/channel/channel-account',
                        name: '渠道账号',
                        component: './Channel/components/ChannelAccount',
                        title: 'biz_channel_pid',
                        access: 'hasRoute',
                    },
                ],
            },
            {
                path: '/operation-manager/car-gps-list',
                name: '车辆GPS工单管理',
                title: 'car_gps_list_operate_manage',
                access: 'hasRoute',
                component: './GpsMng',
            },
            {
                path: '/operation-manager/car-insurance-channel-list',
                name: '车险分期渠道',
                title: 'car_insurance_channel_list',
                access: 'hasRoute',
                component: './CarInsuranceChannel/list',
            },
            {
                path: '/operation-manager/policy/list',
                name: '车险保单管理',
                title: 'policy_list',
                access: 'hasRoute',
                component: './Policy/list',
            },
            // 抽奖活动
            {
                path: '/operation-manager/activity',
                name: '活动管理',
                // 与小贷权限保持一致
                title: 'biz_businessMng_cashList',
                access: 'hasRoute',
                routes: [
                    {
                        path: '/operation-manager/activity/loan-activity',
                        name: '贷中活动',
                        component: './LoanActivity',
                        // 与小贷权限保持一致
                        title: 'biz_businessMng_cashList',
                        access: 'hasRoute',
                    },
                    {
                        path: '/operation-manager/activity/mgm-activity',
                        name: '裂变活动',
                        component: './MGMActivity',
                        // 与小贷权限保持一致
                        title: 'biz_businessMng_cashList',
                        access: 'hasRoute',
                    },
                    {
                        path: '/operation-manager/activity/canvas-activity',
                        name: '画布活动',
                        component: './CanvasActivity',
                        // 与小贷权限保持一致
                        title: 'biz_businessMng_cashList',
                        access: 'hasRoute',
                    },
                ],
            },
            // 奖品管理
            {
                path: '/operation-manager/award-manager',
                name: '奖品管理',
                title: 'award_manager_operate_manage',
                component: './AwardManager',
                access: 'hasRoute',
            },
            {
                path: '/operation-manager/premiumCompany',
                name: '保费收款公司',
                title: 'insurance_company_list_operate_manage',
                component: './PremiumCompany',
                access: 'hasRoute',
            },
            {
                component: './404',
            },
        ],
    },
    {
        name: '系统设置',
        icon: 'setting',
        path: '/sysMng',
        title: 'biz_sysMng',
        access: 'hasRoute',
        routes: [
            {
                name: '数据字典',
                icon: 'user',
                title: 'biz_sysMng_dataDiction',
                access: 'hasRoute',
                path: '/sysMng/dataDiction',
                // component: './CarModelLibrary',
                routes: [
                    {
                        path: '/sysMng/dataDiction/carModelLibrary',
                        name: '车型库',
                        component: './CarModelLibrary',
                    },
                    {
                        path: '/sysMng/dataDiction/promotion',
                        name: '车型库促销方案',
                        component: './Promotion',
                    },
                    {
                        path: '/sysMng/dataDiction/storeConfig',
                        name: '门店配置',
                        component: './StoreConfig',
                    },
                    {
                        path: '/sysMng/dataDiction/licensedCities',
                        name: '上牌城市配置',
                        component: './LicensedCities',
                    },

                ],
            },
        ],
    },
    {
        name: '开发配置',
        icon: 'ExperimentOutlined',
        path: '/dev',
        title: 'dev',
        access: 'hasDevAccess',
        routes: [
            {
                name: 'SSO灰度配置',
                icon: 'user',
                path: '/dev/sso-config',
                component: './DevConfig',
            },
        ],
    },
    // {
    //   path: '/welcome',
    //   name: 'welcome',
    //   icon: 'smile',
    //   component: './Welcome',
    // },
    {
        path: '/',
        redirect: '/dashboard',
    },
    {
        component: './404',
    },
];