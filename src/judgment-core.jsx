import { useState, useRef, useEffect } from "react";

// ══════════════════════════════════════════════════════
// 定数・設定
// ══════════════════════════════════════════════════════

const DIFF_INFO = {
easy: { label:"EASY", star:"★☆☆", color:"#4ade80", desc:"証拠全開示・ヒントあり・検察穏やか", evidenceOpen:3, witnessCount:0 },
normal: { label:"NORMAL", star:"★★☆", color:"#facc15", desc:"証拠3個開示・検察側証人1名", evidenceOpen:3, witnessCount:1 },
hard: { label:"HARD", star:"★★★", color:"#f87171", desc:"証拠2〜3個・偽証人あり・ヒントなし", evidenceOpen:2, witnessCount:2 },
};

const PLAYER_ROLES = {
defense: { label:"弁護士", color:"#4a9eff", icon:"⚖️", goal:"無罪・減刑を勝ち取れ" },
prosecutor: { label:"検察官", color:"#f87171", icon:"🔍", goal:"有罪（求刑通り）を確定させろ" },
judge: { label:"裁判官", color:"#a78bfa", icon:"🔨", goal:"真実を見極め、妥当な判決を下せ" },
};

const PHASE_LABELS = {
PHASE2:"証拠の反論", PHASE3:"被告人尋問",
PHASE4:"証人尋問", PHASE5:"最終弁論",
};

// ══════════════════════════════════════════════════════
// プロンプト生成
// ══════════════════════════════════════════════════════

function buildSystemPrompt(difficulty, playerRole, scenario) {
const dc = DIFF_INFO[difficulty];
const roleInstructions = {
defense: `プレイヤーは弁護士。AIは検察官・裁判官を担当。弁護側の心証スコアが上がると弁護勝利。`,
prosecutor: `プレイヤーは検察官。AIは弁護士・裁判官を担当。検察側の心証スコアが上がる（=弁護側が下がる）と検察勝利。 プレイヤーの発言は検察官の発言として扱う。弁護AI（速水凛、35歳）が反論してくる。score_deltaはプレイヤーに有利な方向（検察有利=弁護側スコア低下）で計算。`,
judge: `プレイヤーは裁判官。AIは検察官・弁護士の両方を担当し、両者が活発に議論する。 プレイヤーは質問・整理・判断を行い、最終的に妥当な判決を下す。score_deltaは「真実に近づいたか」で判定。 hidden_hintには「まだ明かされていない矛盾点」を示唆する。`,
}[playerRole];

return `あなたはAI法廷バトルゲーム「JUDGMENT CORE」の審判エンジンです。

【プレイヤーの役職】${PLAYER_ROLES[playerRole].label}
${roleInstructions}

【事件情報】
${scenario}

【難易度】${dc.label}
証拠開示数：${dc.evidenceOpen}個　証人数：${dc.witnessCount}名
ヒント：${difficulty === "easy" ? "積極的に出す" : difficulty === "normal" ? "控えめに" : "出さない"}
検察自律回復：毎ターン${difficulty === "easy" ? "-2〜3" : difficulty === "normal" ? "-3〜5" : "-4〜6"}

【心証ゲージルール】初期値35（0=検察完全勝利、100=弁護完全勝利）
事実矛盾を突く:+20 / 論理矛盾:+15 / 有利な証言:+15 / 証拠提示:+10
感情・人権:+5〜10 / 論点ずれ:-10 / 根拠なし:-5 / 裁判官無視:-15

【論理の穴】矛盾を突かれたら発動。4穴で相手崩壊。

【TRUE END条件】無罪判決＋公判中に「真犯人示唆」発言あり＋証人から隠し証言を引き出す

【フェーズ順】PHASE2証拠反論→PHASE3被告人尋問→PHASE4証人尋問→PHASE5最終弁論→判決
心証95以上→即時無罪、5以下→即時有罪。

【NORMAL/HARDの証人フェーズ】
PHASE4では検察側証人を登場させ、証言を行わせる。HARDでは1名が偽証の可能性あり。
witness_eventフィールドを使って証人イベントを通知する。

【応答形式】必ずJSON形式のみ。前置き不要。
{
"phase": "現在フェーズ",
"prosecutor_speech": "検察官発言100字以内（検察官モード時は弁護AIの発言）",
"judge_speech": "裁判官発言60字以内",
"logic_leak": false,
"score_delta": 0,
"prosecutor_recovery": -3,
"new_score": 35,
"hidden_hint": null,
"phase_advance": false,
"instant_verdict": null,
"true_end_progress": 0,
"witness_event": null
}
logic_leak: falseまたは{"type":"事実矛盾|論理矛盾|証拠矛盾","message":"40字以内"}
instant_verdict: nullか"無罪"か"有罪"かTRUE_END
witness_event: nullまたは{"name":"証人名","testimony":"証言内容80字以内","is_false":false}
true_end_progress: 0〜3（条件達成数）`;
}

const PRESET_SCENARIOS = [
{
title:"完璧なアリバイを持つ男",
defendant:"永瀬ハルカ（28歳、料理研究家の弟子）",
crime:"師匠・桐島宗一郎の薬瓶にアコニチンを混入し毒殺した疑い",
prosecution_claim:"破門宣告の翌朝、被害者宅に侵入し薬瓶に毒を混入。デモ中に毒が効くよう計算した計画的犯行。",
evidence_open:["謝罪訪問の記録（事件3日前）","被告人のデモ会場記録（アリバイ）","毒物購入履歴（被告人名義なし）"],
evidence_details:["事件3日前に被告人が被害者宅を訪問した記録。被害者本人が迎え入れており、妻もその場にいた。訪問時間は約40分。","事件当日、被告人は200名以上の観客の前で料理デモを行っていた。開始〜終了まで会場を離れた記録はない。","毒物（アコニチン）の購入履歴を全国で照会したが被告人名義での購入は一切確認されていない。"],
witness_details:["被害者の妻。謝罪訪問当日、お茶を出すなど同席していた。被告人と被害者の会話内容を知る唯一の証人。","料理デモの主催者。被告人が当日終始会場にいたことを証言できる立場にある。"],
evidence_hidden:["被害者宅の監視カメラ映像","被告人のスマホ通話記録"],
witnesses:["霧島希美子・被害者の妻","松岡誠一・デモ会場主催者"],
true_culprit_hint:"被害者の妻が保険金目的で第三者に依頼した可能性",
opening_statement:"被告人は破門を恨み、翌朝被害者宅に侵入。薬瓶にアコニチンを混入した計画的な毒殺です。"
},
{
title:"消えた遺産と義弟の影",
defendant:"三島浩二（45歳、不動産会社役員）",
crime:"義父・田村義雄の遺産3億円を横領した疑い",
prosecution_claim:"被告人は義父の認知症を悪用し、偽造委任状で遺産を自己名義に書き換えた。",
evidence_open:["公正証書遺言のコピー","被告人名義の銀行口座記録","義父の診断書（軽度認知症）"],
evidence_details:["義父が正式に作成した遺言書のコピー。財産は実娘に全額相続と明記されている。被告人への言及は一切ない。","事件後に被告人名義口座に3億円が入金された記録。送金元は義父名義の口座。","義父は軽度の認知症と診断されていたが、意思能力は一定程度あったとも記載されている。"],
witness_details:["被害者の実娘。遺産が消えたことを最初に発見した。父親との関係や被告人への態度について証言できる。","義父の長年の主治医。認知症の程度・意思能力の有無について専門的な証言が可能。"],
evidence_hidden:["委任状の筆跡鑑定結果","公証役場の訪問記録"],
witnesses:["田村さやか・被害者の実娘","山本医師・被害者の主治医"],
true_culprit_hint:"実は実娘が父親を唆し被告人に罪をなすりつけようとしている",
opening_statement:"被告人は義父の認知症を悪用し、3億円の遺産を横領した卑劣な犯行です。"
},
{
title:"深夜の研究室火災",
defendant:"沢村京介（33歳、製薬会社研究員）",
crime:"同僚研究員・木下誠の研究室に放火し死亡させた疑い",
prosecution_claim:"被告人は特許争いを動機に深夜研究室に侵入し放火。木下研究員は逃げ遅れ死亡した。",
evidence_open:["被告人のICカード入室記録","現場の加速剤成分","両者の特許申請書類"],
evidence_details:["火災当日23:14に被告人のICカードで研究棟に入室した記録がある。ただし退室記録は残っていない。","火災現場から灯油系の加速剤成分が検出された。被告人の自宅からは同種成分は見つかっていない。","被告人と被害者は同一テーマで特許を争っており、申請日が2日違いだった。被告人の申請が後れをとっていた。"],
witness_details:["同部署の直属上司。被告人と被害者の対立関係を最もよく知る立場。当日の業務状況についても証言できる。","当日深夜に研究棟周辺を清掃していた老女。不審な人物や車を目撃した可能性がある重要な証人。"],
evidence_hidden:["防犯カメラの消去データ","保険会社への問い合わせ記録"],
witnesses:["田中部長・同部署の上司","清掃員の老女・当夜の目撃者"],
true_culprit_hint:"会社ぐるみの研究データ隠蔽があり上司が真犯人の可能性",
opening_statement:"被告人は特許を奪われることを恐れ、深夜研究室に放火し同僚を死亡させました。"
},
{
title:"アイドルへの脅迫状",
defendant:"古賀修平（41歳、元カメラマン）",
crime:"人気アイドル・星野ゆいへの脅迫および傷害の疑い",
prosecution_claim:"被告人は解雇を恨み脅迫文を送付。握手会会場で刃物で切りかかり全治2週間の傷害を負わせた。",
evidence_open:["脅迫文（被告人の指紋付き）","被告人の解雇通知書","被害者の診断書"],
evidence_details:["脅迫文に被告人の指紋が付着。ただし脅迫文の筆跡鑑定はまだ行われていない。","被告人が6ヶ月前に事務所を解雇された通知書。解雇理由は'業務上の不正' とあるが詳細は不明。","被害者は全治2週間の切り傷を負った。凶器は小型刃物とされるが現場での発見はされていない。"],
witness_details:["被害者本人。握手会での出来事を直接証言できる。しかし事件直前の被告人の様子については記憶が曖昧。","当日被害者に同行していたマネージャー。事件直前から直後を目撃しており、加害者の特徴を証言できる立場。"],
evidence_hidden:["送付時の防犯カメラ映像","被告人のスマートフォン履歴"],
witnesses:["星野ゆい・被害者本人","マネージャー川島・事件当日の同行者"],
true_culprit_hint:"事務所内部の人間がライバルアイドル蹴落としのため古賀を利用した疑い",
opening_statement:"被告人は解雇への怨恨から脅迫を重ね、ついに凶器で被害者へ危害を加えました。"
},
{
title:"市議会議員の賄賂疑惑",
defendant:"桜田一郎（58歳、市議会議員）",
crime:"建設会社から総額500万円の賄賂を受け取った疑い",
prosecution_claim:"被告人は公共工事の入札情報を建設会社に漏洩し、見返りに現金500万円を複数回に分け受領した。",
evidence_open:["被告人名義の現金出金記録","社長との会食記録","入札結果の不自然な一致"],
evidence_details:["被告人の口座から3回にわたり計500万円が出金されている。出金後の使途は不明。","建設会社社長との会食が入札前後に4回記録されている。費用は社長側が負担。","過去3年間で被告人が関与した入札9件中8件で同社が落札。統計的に不自然な一致とされる。"],
witness_details:["被告人に賄賂を渡したと供述している建設会社社長。ただし自身の罪を軽くするための証言の可能性もある。","入札業務を担当していた若手職員。被告人から直接指示を受けたと主張しているが、証拠は本人の証言のみ。"],
evidence_hidden:["現金授受の現場写真","内部告発者の証言録音"],
witnesses:["建設会社社長・山崎康夫","市役所入札担当の若手職員"],
true_culprit_hint:"市長が主導しており被告人は脅されて協力させられていた",
opening_statement:"被告人は市議の立場を悪用し、入札情報と引き換えに500万円の賄賂を受け取りました。"
},
{
title:"夜の港の密輸疑惑",
defendant:"龍崎剛（52歳、海運会社経営者）",
crime:"密輸グループと共謀し覚醒剤300kgを日本に持ち込んだ疑い",
prosecution_claim:"被告人は自社船舶を使い海外組織と連携。覚醒剤を貨物に偽装し密輸した首謀者である。",
evidence_open:["入港記録と貨物マニフェスト","被告人の海外口座への送金記録","押収された覚醒剤の鑑定書"],
evidence_details:["問題の船舶が3回にわたり同じ港に入港した記録。貨物は「機械部品」と申告されていたが検査は省略されていた。","被告人名義の海外口座（ケイマン諸島）に総額2億円の入金がある。送金元は特定されていない。","押収された覚醒剤300kgの純度・成分を分析した鑑定書。同種のものが海外の特定組織と一致するとされる。"],
witness_details:["内部告発をした元船員。実際に密輸に関与したと証言しているが、減刑取引中の証人であり信憑性が問われる。","押収を担当した税関職員。現場の状況と証拠の発見経緯について客観的な証言が可能。"],
evidence_hidden:["密輸組織との通話記録","内部告発した元船員の証言"],
witnesses:["元船員・宮本達也（内部告発者）","税関職員・岡田係長"],
true_culprit_hint:"実は競合会社の社長が被告人を陥れるために証拠を偽造した",
opening_statement:"被告人は自社船を使い覚醒剤300kgを密輸した。組織的かつ悪質な犯行です。"
},
{
title:"消えた美術品の行方",
defendant:"藤原玲子（39歳、美術館学芸員）",
crime:"所属美術館から時価2億円の絵画を窃盗した疑い",
prosecution_claim:"被告人は警備の盲点を熟知しており、閉館後に絵画を搬出。個人コレクターへ売却した。",
evidence_open:["被告人の深夜残業記録","美術館警備ログの空白時間","被告人の不審な預金増加"],
evidence_details:["事件前後3週間、被告人が毎週木曜の閉館後も1〜2時間残業していた記録。業務上の必要性は確認されていない。","事件当夜22:00〜23:30の間、警備ログに空白がある。システム障害とされているが原因は不明。","事件後3ヶ月以内に被告人の口座に計800万円の入金がある。給与以外の収入については説明がない。"],
witness_details:["警備会社の主任。警備システムの構造と当日の空白時間について証言できる。ただし被告人とは顔見知り。","同じ部署の同僚学芸員。被告人の行動パターンや絵画の管理状況について詳しく知る立場にある。"],
evidence_hidden:["監視カメラの死角映像","絵画を購入したコレクターの証言"],
witnesses:["警備会社主任・坂本健","同僚学芸員・中村里奈"],
true_culprit_hint:"館長が保険金詐欺を目的に絵画を隠蔽し被告人に罪を着せた",
opening_statement:"被告人は館内構造を悪用し2億円の絵画を盗み出した。計画的な窃盗です。"
},
{
title:"医師の過剰処方疑惑",
defendant:"杉本隆志（47歳、内科クリニック院長）",
crime:"患者に向精神薬を過剰処方し薬物依存を引き起こした業務上過失致傷の疑い",
prosecution_claim:"被告人は製薬会社から多額の謝礼を受け取り、不必要な向精神薬を大量処方し患者を依存症にした。",
evidence_open:["製薬会社からの謝礼金記録","患者の処方箋履歴","被害患者の診断書"],
evidence_details:["製薬会社から被告人への「講演料」名目の支払い記録。過去2年で計1200万円。業界平均の5倍以上とされる。","被告人が処方した向精神薬の量は、同地域の医師平均の8倍。一部患者には3年以上連続処方されていた。","依存症と診断された患者の診断書。離脱症状が重く、現在も治療中。被告人の処方が原因と記載されている。"],
witness_details:["依存症になった被害患者。被告人から「これを飲めば楽になる」と言われたと主張している。","製薬会社のMR（医薬情報担当者）。被告人への接待や謝礼金の詳細について証言できる立場にある。"],
evidence_hidden:["製薬会社の接待費記録","他の医師による処方量比較データ"],
witnesses:["被害患者・山本花子","製薬会社MR・伊藤誠"],
true_culprit_hint:"製薬会社が医師に圧力をかけており被告人は脅迫されていた",
opening_statement:"被告人は金銭的利益のため患者に過剰な薬を処方し依存症にした医師の背信行為です。"
},
{
title:"SNSを使った詐欺事件",
defendant:"北条悠斗（26歳、フリーランサー）",
crime:"SNSで投資話を持ちかけ総額8000万円を騙し取った詐欺の疑い",
prosecution_claim:"被告人はSNSで著名投資家を装い、高利回りを謳って被害者100名から総額8000万円を詐取した。",
evidence_open:["被告人のSNSアカウント記録","被害者への送金履歴","被告人名義の口座残高"],
evidence_details:["被告人が運営していたSNSアカウントの投稿記録。著名投資家を装い高利回りを謳う投稿が2年間で500件以上。","被害者100名から被告人名義口座への送金履歴。1人あたり平均80万円、総額8000万円。","被告人名義口座の残高は現在わずか30万円。8000万円の大半は海外送金されたとみられる。"],
witness_details:["被害者代表の高橋氏。SNSを見て信用した経緯と被害額について証言する。被告人と実際に会ったことはない。","ITフォレンジック専門家。SNSアカウントの運営実態とデジタル証拠の分析結果について専門的証言が可能。"],
evidence_hidden:["被告人の共犯者とのやりとり","海外口座への送金記録"],
witnesses:["被害者代表・高橋正雄（60歳）","ITフォレンジック専門家・田島博士"],
true_culprit_hint:"背後に組織的な詐欺グループがあり被告人は末端の実行役に過ぎない",
opening_statement:"被告人はSNSで投資家を装い100名以上から8000万円を騙し取った悪質な詐欺師です。"
},
{
title:"大学教授のハラスメント",
defendant:"岩田修造（61歳、大学教授）",
crime:"研究室の大学院生に対するアカデミックハラスメントおよび強要罪の疑い",
prosecution_claim:"被告人は学生の論文を無断で自分の名義で発表し、抗議した学生を退学に追い込むと脅した。",
evidence_open:["論文提出記録と著者名の変更履歴","学生への脅迫メール","大学ハラスメント相談室の記録"],
evidence_details:["学生が提出した論文の著者名が、提出から2週間後に被告人単独名義に変更されたシステム記録。学生の承諾記録はない。","被告人から学生へのメール。「退学させることもできる」「就職先に話す」などの文言が含まれる。","学生が相談室に相談した記録。しかし大学は当初「証拠不十分」として調査を打ち切っていた。"],
witness_details:["被害学生。論文盗用と脅迫の経緯を直接証言できる。しかし被告人への恐怖から証言を躊躇している。","ハラスメント委員の教授。相談室の対応経緯と大学の組織的な対応について証言できる立場。"],
evidence_hidden:["他の被害学生の証言録音","大学内の隠蔽工作メール"],
witnesses:["被害学生・村田奈緒","大学ハラスメント委員・西野教授"],
true_culprit_hint:"大学の研究費不正が背景にあり大学側が教授を使って隠蔽しようとしていた",
opening_statement:"被告人は地位を利用し学生の研究を盗用。抵抗した学生を脅迫した卑劣な行為です。"
},
{
title:"連続放火魔の正体",
defendant:"村上透（34歳、無職）",
crime:"住宅街で3件の連続放火を行い1名を死亡させた疑い",
prosecution_claim:"被告人は現場近くに居住し、各火災の直前に現場付近を目撃されている。放火の動機は近隣トラブル。",
evidence_open:["現場付近の防犯カメラ映像","被告人と被害者の近隣トラブル記録","現場で採取したライターオイル"],
evidence_details:["各火災の30分前後に被告人に似た人物が現場近くを歩く映像。ただし画質が悪く断定はできない。","過去1年で被告人と被害者（3件の放火被害者のうち1名）の間に騒音トラブルが3回記録されている。","現場から採取されたライターオイルの成分。市販品と一致し、被告人宅の捜索でも同種製品が発見された。"],
witness_details:["近隣に住む老人。火災当夜に不審な人物を見かけたと証言しているが、年齢や服装の記憶が曖昧。","最初の火災に出動した消防士。出火状況・延焼パターンから放火の可能性が高いと判断した経緯を証言できる。"],
evidence_hidden:["被告人のアリバイを証明する可能性のある映像","真犯人の足跡証拠"],
witnesses:["近隣住民・佐々木老人","消防署員・原田隊長"],
true_culprit_hint:"実は被告人の元交際相手が嫉妬から放火し被告人に罪をなすりつけた",
opening_statement:"被告人は3件の放火を行い1名を死亡させた。状況証拠は全て被告人を指し示しています。"
},
{
title:"プロ野球選手の八百長",
defendant:"神崎竜也（29歳、プロ野球選手）",
crime:"反社会的勢力と共謀し試合の結果を操作した八百長行為の疑い",
prosecution_claim:"被告人は多額の借金返済のため、特定の試合で故意にエラーを犯し反社組織に利益を与えた。",
evidence_open:["被告人の借金返済記録","問題試合のプレー映像分析","反社構成員との接触記録"],
evidence_details:["被告人が消費者金融から借り入れた総額3000万円の記録。問題の試合直後に全額完済されている。","問題の試合で被告人が犯した3つのエラーをAI解析したレポート。意図的なミスの可能性が67%と算出されている。","被告人が反社組織の構成員と試合前日に会食していた記録。場所は個室居酒屋で監視カメラには写っていない。"],
witness_details:["反社組織の元構成員で証人保護中。被告人との取引を直接証言できるが、自身も犯罪に関与した人物。","スポーツ評論家。問題の試合映像を詳細に分析し、エラーが意図的かどうかについて専門的意見を述べる。"],
evidence_hidden:["被告人の隠し口座への入金記録","反社組織の内部メモ"],
witnesses:["元反社組織構成員・木村（証人保護中）","スポーツ評論家・大野氏"],
true_culprit_hint:"チームのフロントが組織的に関与しており被告人は脅されて従った",
opening_statement:"被告人は反社組織と結託し試合を操作。スポーツの公正性を著しく損ないました。"
},
{
title:"天才ハッカーの標的",
defendant:"黒川蓮（22歳、ITエンジニア）",
crime:"大手銀行のシステムに不正アクセスし2億円を不正送金した疑い",
prosecution_claim:"被告人は高度な技術を持ち、銀行のセキュリティを突破。海外口座に2億円を送金した。",
evidence_open:["不正アクセスのIPアドレス記録","被告人のPCから発見されたハッキングツール","不正送金の記録"],
evidence_details:["不正アクセスに使われたIPアドレスが被告人の自宅回線と一致。ただしIPアドレスは偽装可能とする専門家意見もある。","被告人のPCに高度なハッキングツールが複数インストールされていた。ただし使用履歴のタイムスタンプが不自然。","銀行から海外口座への2億円の不正送金記録。送金先口座の名義人は特定されていない。"],
witness_details:["銀行のセキュリティ担当部長。システム侵害の技術的詳細と被告人のスキルレベルとの比較について証言する。","サイバー犯罪捜査の専門家。デジタル証拠の信憑性と遠隔操作の可能性について専門的見解を述べる。"],
evidence_hidden:["真のアクセス元のログ","被告人PCへの遠隔操作の痕跡"],
witnesses:["銀行セキュリティ担当・吉田部長","サイバー犯罪捜査官・松本警部"],
true_culprit_hint:"被告人のPCは第三者に遠隔操作されており真犯人は別の天才ハッカー",
opening_statement:"被告人は卓越したハッキング技術で銀行システムを侵害し2億円を詐取しました。"
},
];

// ══════════════════════════════════════════════════════
// スコア計算
// ══════════════════════════════════════════════════════

function calcFinalScore(gameState) {
const { verdict, logicLeaks, conversationHistory, trueEndProgress, difficulty } = gameState;
const turns = conversationHistory.filter(m => m.role === "user").length;
const baseScore = verdict === "無罪" ? 1000 : verdict === "有罪" ? 0 : 500;
const logicScore = logicLeaks * 200;
const efficiencyScore = Math.max(0, 500 - turns * 20);
const trueEndScore = trueEndProgress >= 3 ? 500 : trueEndProgress * 100;
const diffBonus = { easy: 1.0, normal: 1.3, hard: 1.6 }[difficulty] || 1;
const total = Math.round((baseScore + logicScore + efficiencyScore + trueEndScore) * diffBonus);
const rank = total >= 2500 ? "SS" : total >= 2000 ? "S" : total >= 1500 ? "A" : total >= 1000 ? "B" : total >= 500 ? "C" : "D";
return { baseScore, logicScore, efficiencyScore, trueEndScore, total, rank, turns, diffBonus };
}

// ══════════════════════════════════════════════════════
// メインコンポーネント
// ══════════════════════════════════════════════════════

export default function JudgmentCore() {
const [screen, setScreen] = useState("title");
const [difficulty, setDifficulty] = useState(null);
const [playerRole, setPlayerRole] = useState(null);
const [scenarioType, setScenarioType] = useState(null);
const [customInput, setCustomInput] = useState("");
const [scenarioData, setScenarioData] = useState(null);
const [genError, setGenError] = useState("");
const [gameState, setGameState] = useState(null);
const [input, setInput] = useState("");
const [loading, setLoading] = useState(false);
const [scoreDelta, setScoreDelta] = useState(null);
const [showPanel, setShowPanel] = useState(false);
const messagesEndRef = useRef(null);

useEffect(() => {
messagesEndRef.current?.scrollIntoView({ behavior:"smooth" });
}, [gameState?.messages, loading]);

// ── シナリオ生成（AI即興 or プリセットランダム）──
const generateScenario = async () => {
setScreen("generating");
// プリセット70%・AI即興30%
const usePreset = Math.random() < 0.7;
const fallback = PRESET_SCENARIOS[Math.floor(Math.random() * PRESET_SCENARIOS.length)];
if (usePreset) { setScenarioData(fallback); startGame(fallback); return; }
try {
const res = await fetch("https://api.anthropic.com/v1/messages", {
method:"POST",
headers:{
  "Content-Type": "application/json",
  "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
},
body: JSON.stringify({
model:"claude-sonnet-4-20250514",
max_tokens:900,
messages:[{role:"user", content:`日本語で法廷バトルゲーム用の刑事事件シナリオを1つ生成してください。 以下のJSON形式のみで返答。コードブロック不要。説明文不要。 {"title":"事件名15字以内","defendant":"氏名（年齢、職業）","crime":"容疑50字以内","prosecution_claim":"検察の主張80字以内","evidence_open":["開示証拠1","開示証拠2","開示証拠3"],"evidence_details":["証拠1の詳細説明60字以内","証拠2の詳細説明60字以内","証拠3の詳細説明60字以内"],"evidence_hidden":["未開示証拠1","未開示証拠2"],"witnesses":["証人名・関係性","証人名・関係性"],"witness_details":["証人1の詳細説明60字以内","証人2の詳細説明60字以内"],"opening_statement":"御堂検察官の冒頭陳述100字以内"}`}]
}),
});
const data = await res.json();
if (data.error || !data.content?.length) throw new Error("API失敗");
const raw = data.content.map(c=>c.text||"").join("");
if (!raw.trim()) throw new Error("raw空: content=" + JSON.stringify(data.content).slice(0,80));
let parsed = null;
const fence = raw.match(/`(?:json)?\s*([\s\S]*?)`/);
if (fence) { try { parsed = JSON.parse(fence[1].trim()); } catch(e){} }
if (!parsed) { const m = raw.match(/{[\s\S]*}/); if(m){ try{ parsed = JSON.parse(m[0]); }catch(e){} } }
if (!parsed) throw new Error("JSON失敗");
parsed.evidence_open = Array.isArray(parsed.evidence_open) ? parsed.evidence_open : ["証拠書類一式"];
parsed.evidence_details = Array.isArray(parsed.evidence_details) ? parsed.evidence_details : [];
parsed.evidence_hidden = Array.isArray(parsed.evidence_hidden) ? parsed.evidence_hidden : [];
parsed.witnesses = Array.isArray(parsed.witnesses) ? parsed.witnesses : [];
parsed.witness_details = Array.isArray(parsed.witness_details) ? parsed.witness_details : [];
parsed.opening_statement = parsed.opening_statement || "被告人の有罪を立証します。";
setScenarioData(parsed);
startGame(parsed);
} catch {
setScenarioData(fallback);
startGame(fallback);
}
};

// ── ゲーム開始 ──
const startGame = (scenario) => {
const sc = scenario || {
title:"持ち込み事件", defendant:"（プレイヤー指定）",
crime:customInput, prosecution_claim:"AIが展開します",
evidence_open:["（シナリオに基づき展開）"], evidence_hidden:[],
witnesses:[], opening_statement:`持ち込みシナリオ：${customInput.slice(0,80)}`,
};
const scenarioText = `【事件名】${sc.title}\n【被告人】${sc.defendant}\n【容疑】${sc.crime}\n【検察の主張】${sc.prosecution_claim}\n【弁護側開示証拠】${sc.evidence_open.join(" / ")}\n【未開示証拠】${(sc.evidence_hidden||[]).join(" / ")||"なし"}\n【証人】${(sc.witnesses||[]).join(" / ")||"なし"}`;
setGameState({
phase:"PHASE2", score:35, logicLeaks:0, difficulty, playerRole,
scenarioText, scenarioTitle:sc.title,
evidenceOpen:sc.evidence_open||[], evidenceHidden:sc.evidence_hidden||[],
evidenceDetails:sc.evidence_details||[], witnessDetails:sc.witness_details||[],
witnesses:sc.witnesses||[], trueEndProgress:0,
messages:[
{role:"system_open", text:`第一回公判を開廷します。${sc.title}。${PLAYER_ROLES[playerRole].label}、準備はよろしいですか。`, speaker:"朝比奈裁判官"},
{role:"prosecutor", text:sc.opening_statement, speaker:"御堂検察官"},
],
conversationHistory:[], gameOver:false, verdict:null, finalScore:null,
});
setScreen("game");
};

// ── 発言送信 ──
const handleSubmit = async () => {
if (!input.trim() || loading || gameState?.gameOver) return;
const userText = input.trim();
setInput(""); setLoading(true);
const roleLabel = PLAYER_ROLES[gameState.playerRole]?.label || "プレイヤー";
const newMessages = [...gameState.messages, {role:"player", text:userText, speaker:roleLabel}];
setGameState(s => ({...s, messages:newMessages}));
const newHistory = [...gameState.conversationHistory,
{role:"user", content:`【${roleLabel}の発言】${userText}\n【現在の心証スコア】${gameState.score}\n【論理の穴カウント】${gameState.logicLeaks}\n【TrueEnd進捗】${gameState.trueEndProgress}`}
];
try {
const response = await fetch("https://api.anthropic.com/v1/messages", {
method: "POST",
headers: {
  "Content-Type": "application/json",
  "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
},
body: JSON.stringify({
model: "claude-sonnet-4-20250514",
max_tokens: 600,
system: buildSystemPrompt(gameState.difficulty, gameState.playerRole, gameState.scenarioText),
messages: newHistory,
})
});
const data = await response.json();
const debugInfo = JSON.stringify(data).slice(0,120);
if (!data.content) throw new Error("no content: " + debugInfo);
const raw = data.content.map(c=>c.text||"").join("");
if (!raw.trim()) throw new Error("raw空: content=" + JSON.stringify(data.content).slice(0,80));
const rawPreview = raw.slice(0,60);
let parsed = null;
const fence = raw.match(/`(?:json)?\s*([\s\S]*?)`/);
if (fence) { try { parsed = JSON.parse(fence[1].trim()); } catch(e) {} }
if (!parsed) { const m = raw.match(/{[\s\S]*}/); if (m) { try { parsed = JSON.parse(m[0]); } catch(e) {} } }
if (!parsed) { try { parsed = JSON.parse(raw.trim()); } catch(e) {} }
if (!parsed) throw new Error("JSON失敗[" + rawPreview + "]");
const newScore = Math.max(0,Math.min(100, parsed.new_score ?? gameState.score+(parsed.score_delta||0)+(parsed.prosecutor_recovery||-3)));
const newLeaks = gameState.logicLeaks + (parsed.logic_leak ? 1 : 0);
const newTrueEnd = Math.max(gameState.trueEndProgress, parsed.true_end_progress||0);
const delta = newScore - gameState.score;
const added = [];

if (parsed.logic_leak) added.push({role:"logic_leak", text:`⚡ 論理の穴！「${parsed.logic_leak.message}」`});
if (parsed.witness_event) added.push({role:"witness", text:parsed.witness_event.testimony, speaker:parsed.witness_event.name, isFalse:parsed.witness_event.is_false});
if (parsed.prosecutor_speech) added.push({role:"prosecutor", text:parsed.prosecutor_speech, speaker:gameState.playerRole==="prosecutor"?"速水弁護士":"御堂検察官"});
if (parsed.judge_speech) added.push({role:"judge", text:parsed.judge_speech, speaker:"朝比奈裁判官"});
if (parsed.hidden_hint) added.push({role:"hint", text:`💡 ${parsed.hidden_hint}`});
if (parsed.phase_advance) added.push({role:"phase_change", text:`── ${parsed.phase_advance} ──`});

let verdict=null, gameOver=false, finalScore=null;
if (parsed.instant_verdict === "TRUE_END") {
verdict="TRUE_END"; gameOver=true;
added.push({role:"verdict", text:"TRUE ENDING — 真相解明", verdict:"TRUE_END"});
} else if (parsed.instant_verdict) {
verdict=parsed.instant_verdict; gameOver=true;
added.push({role:"verdict", text:verdict==="無罪"?"無罪判決":"有罪判決", verdict});
} else if (newScore>=95) {
verdict="無罪"; gameOver=true;
added.push({role:"verdict", text:"圧勝！即時無罪判決", verdict:"無罪"});
} else if (newScore<=5) {
verdict="有罪"; gameOver=true;
added.push({role:"verdict", text:"敗北。有罪判決", verdict:"有罪"});
}
if (gameOver) finalScore = calcFinalScore({...gameState, verdict, logicLeaks:newLeaks, trueEndProgress:newTrueEnd, conversationHistory:[...newHistory]});

setScoreDelta(delta);
setTimeout(()=>setScoreDelta(null),1400);
const assistantSummary = [
parsed.prosecutor_speech || "",
parsed.judge_speech || "",
].filter(Boolean).join(" / ");
const fullHistory = [...newHistory, {role:"assistant", content: assistantSummary || "（法廷が反応しました）"}];
const trimmedHistory = fullHistory.length > 16 ? fullHistory.slice(fullHistory.length - 16) : fullHistory;
setGameState(s=>({
...s, score:newScore, logicLeaks:newLeaks, trueEndProgress:newTrueEnd,
phase:parsed.phase_advance||parsed.phase||s.phase,
messages:[...newMessages,...added],
conversationHistory: trimmedHistory,
gameOver, verdict, finalScore,
}));
} catch(err) {
let msg;
if (typeof err === "string") msg = "str:" + err;
else if (err && err.message) msg = "msg:" + err.message;
else msg = "unknown:" + JSON.stringify(err).slice(0,60);
setGameState(s=>({...s, messages:[...newMessages,{role:"error",text:"DBG: " + msg}]}));
}
setLoading(false);
};

const resetAll = () => {
setScreen("title"); setDifficulty(null); setPlayerRole(null);
setScenarioType(null); setCustomInput(""); setScenarioData(null);
setGameState(null); setInput(""); setShowPanel(false);
};

const gColor = !gameState ? "#facc15" : gameState.score>=70?"#4ade80":gameState.score>=40?"#facc15":"#f87171";
const gLabel = !gameState ? "" : gameState.score>=70?"弁護優勢":gameState.score>=50?"拮抗":gameState.score>=30?"検察優勢":"検察圧倒";

// ══════════════════════════════════════════════════════
// CSS
// ══════════════════════════════════════════════════════
const CSS = `@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600;700&family=Cinzel:wght@700&display=swap'); *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent} ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:2px} .tg{font-family:'Cinzel',serif;letter-spacing:.22em;background:linear-gradient(120deg,#b8943c,#f0dfa0,#b8943c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text} .gf{transition:width .7s cubic-bezier(.4,0,.2,1)} .dp{position:absolute;right:0;top:-18px;font-size:.72em;font-weight:700;animation:pu 1.4s ease forwards;pointer-events:none} @keyframes pu{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-22px)}} .bub{padding:9px 13px;border-radius:0 10px 10px 0;line-height:1.85} .bp{background:#0d1e30;border-left:3px solid #4a9eff} .bpr{background:#200e0e;border-left:3px solid #f87171} .bj{background:#0e0e20;border-left:3px solid #a78bfa} .bw{background:#1a0e20;border-left:3px solid #e879f9} .bs{background:#0f0f0f;border:1px solid #222;border-radius:8px;text-align:center;color:#666} .blk{padding:9px 13px;background:#091a09;border:1px solid #4ade8044;border-radius:10px;text-align:center;color:#4ade80;font-weight:700;animation:lk .35s ease} .bhi{padding:7px 12px;background:#111;border:1px dashed #252525;border-radius:8px;color:#5a5a5a;font-size:.8em;font-style:italic} .psep{text-align:center;color:#b8943c;letter-spacing:.18em;font-size:.75em;padding:5px 0} @keyframes lk{from{transform:scale(.94);opacity:.4}to{transform:scale(1);opacity:1}} .vw{padding:18px 14px;background:linear-gradient(135deg,#061606,#09200a);border:2px solid #4ade80;border-radius:14px;text-align:center;color:#4ade80;font-family:'Cinzel',serif;letter-spacing:.2em;animation:gg 1s ease infinite alternate} .vl{padding:18px 14px;background:linear-gradient(135deg,#160606,#200909);border:2px solid #f87171;border-radius:14px;text-align:center;color:#f87171;font-family:'Cinzel',serif;letter-spacing:.2em} .vt{padding:18px 14px;background:linear-gradient(135deg,#060616,#090920);border:2px solid #a78bfa;border-radius:14px;text-align:center;color:#a78bfa;font-family:'Cinzel',serif;letter-spacing:.2em;animation:gt 1s ease infinite alternate} @keyframes gg{from{box-shadow:0 0 6px #4ade8028}to{box-shadow:0 0 20px #4ade8060}} @keyframes gt{from{box-shadow:0 0 6px #a78bfa28}to{box-shadow:0 0 20px #a78bfa60}} .gb{background:linear-gradient(135deg,#c9a84c,#8a6420);border:none;color:#060606;font-family:'Cinzel',serif;font-weight:700;border-radius:10px;cursor:pointer;transition:all .12s;touch-action:manipulation;-webkit-user-select:none;user-select:none;width:100%;padding:14px;font-size:.95em;letter-spacing:.08em} .gb:active{transform:scale(.97);filter:brightness(1.15)} .gb:disabled{opacity:.3;cursor:not-allowed} .gho{background:transparent;border:1px solid #2a2a2a;color:#666;font-family:'Noto Serif JP',serif;border-radius:10px;cursor:pointer;transition:all .12s;touch-action:manipulation;padding:12px;font-size:.85em;width:100%} .gho:active{background:#1a1a1a;color:#999} .dc{border:1px solid #2a2a2a;border-radius:12px;padding:14px 16px;cursor:pointer;transition:all .15s;touch-action:manipulation;background:#0f0f0f} .dc:active{transform:scale(.98)} .dc.sel{border-color:#c9a84c88;background:#120e00} .rc{border:1px solid #2a2a2a;border-radius:12px;padding:14px 16px;cursor:pointer;transition:all .15s;touch-action:manipulation;background:#0f0f0f} .rc:active{transform:scale(.98)} .rc.sel{border-color:#c9a84c88;background:#0a0a1a} .sb{background:linear-gradient(135deg,#c9a84c,#8a6420);border:none;color:#060606;font-family:'Cinzel',serif;font-weight:700;border-radius:10px;cursor:pointer;transition:all .12s;touch-action:manipulation;-webkit-user-select:none;user-select:none} .sb:active:not(:disabled){transform:scale(.95);filter:brightness(1.2)} .sb:disabled{opacity:.3;cursor:not-allowed} textarea{background:#0f0f0f;border:1px solid #252525;color:#e8e0d0;font-family:'Noto Serif JP',serif;font-size:16px;resize:none;outline:none;border-radius:10px;line-height:1.6;transition:border-color .2s;-webkit-appearance:none} textarea:focus{border-color:#c9a84c44} textarea::placeholder{color:#333} .dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:#3a3a3a;margin:0 2px} .dot:nth-child(1){animation:db 1.1s 0s infinite} .dot:nth-child(2){animation:db 1.1s .2s infinite} .dot:nth-child(3){animation:db 1.1s .4s infinite} @keyframes db{0%,80%,100%{transform:scale(.7);opacity:.3}40%{transform:scale(1.2);opacity:1}} .sl{font-family:'Cinzel',serif;letter-spacing:.15em;font-size:.6em;margin-bottom:3px} .mt{font-size:.9em} .fi{animation:fi .4s ease} @keyframes fi{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} .panel-overlay{position:fixed;inset:0;background:#000a;z-index:100;animation:fi .2s ease} .panel{position:fixed;right:0;top:0;bottom:0;width:82vw;max-width:340px;background:#0d0d18;border-left:1px solid #2a2a2a;z-index:101;display:flex;flex-direction:column;animation:sp .25s ease} @keyframes sp{from{transform:translateX(100%)}to{transform:translateX(0)}} .score-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1a1a1a;font-size:.82em} .rank-badge{font-family:'Cinzel',serif;font-size:3em;font-weight:700;letter-spacing:.1em}`;

const wrap = (content) => (
<div style={{height:"100dvh",background:"#0a0a0f",color:"#e8e0d0",fontFamily:"'Noto Serif JP',Georgia,serif",display:"flex",flexDirection:"column",overflow:"hidden",maxWidth:600,margin:"0 auto",width:"100%"}}>
<style>{CSS}</style>
{content}
</div>
);

// ══════════════════════════════════════════════════════
// 各画面
// ══════════════════════════════════════════════════════

// タイトル
if (screen==="title") return wrap(
<div className="fi" style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 24px"}}>
<div style={{fontSize:".65em",color:"#484848",letterSpacing:".3em",marginBottom:12}}>A I　L E G A L　B A T T L E</div>
<div className="tg" style={{fontSize:"2.4em",lineHeight:1.1,textAlign:"center",marginBottom:8}}>JUDGMENT<br/>CORE</div>
<div style={{fontSize:".7em",color:"#484848",letterSpacing:".15em",marginBottom:48}}>ジャッジメント・コア　v0.4</div>
<div style={{width:"100%",display:"flex",flexDirection:"column",gap:10}}>
<button className="gb" onClick={()=>setScreen("rules")}>開廷準備</button>
<div style={{fontSize:".62em",color:"#2a2a2a",textAlign:"center",marginTop:4}}>PROTOTYPE — EASY / NORMAL / HARD</div>
</div>
</div>
);

// ルール説明
if (screen==="rules") return wrap(
<div className="fi" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
<div style={{background:"#0c0c13",borderBottom:"1px solid #181818",padding:"12px 16px",flexShrink:0}}>
<div className="tg" style={{fontSize:".9em"}}>JUDGMENT CORE</div>
<div style={{fontSize:".6em",color:"#484848",marginTop:2}}>ルール説明</div>
</div>
<div style={{flex:1,overflowY:"auto",padding:"16px",WebkitOverflowScrolling:"touch"}}>
<div style={{fontSize:".75em",color:"#c9a84c",letterSpacing:".15em",marginBottom:12}}>■ ゲームの流れ</div>
{[
["⚖️","役職（弁護士・検察官・裁判官）を選び、AIと法廷で戦います。"],
["💬","選択肢はありません。テキストを自由入力して発言してください。"],
["📊","心証ゲージが70以上→無罪、20以下→有罪。途中決着もあります。"],
["⚡","相手の矛盾を突くと「論理の穴」が発動。4穴で相手が崩壊します。"],
["🔍","証人尋問では質問の仕方で引き出せる証言が変わります。"],
["🌟","TRUE END：特定の条件を満たすと真相解明エンドに辿り着けます。自力で発見してください。"],
["📁","法廷画面の右上の📁ボタンで「事件ファイル」を開けます。開示済み証拠・証人リスト・TRUE END進捗を確認できます。"],
["🔄","AI生成シナリオは毎回異なる事件が登場します（即興 or プリセット）。"],
].map(([ic,tx],i)=>(
<div key={i} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid #1a1a1a",fontSize:".88em",lineHeight:1.7}}>
<div style={{flexShrink:0,width:20,textAlign:"center",color:"#c9a84c",marginTop:1}}>{ic}</div>
<div style={{color:"#aaa"}}>{tx}</div>
</div>
))}
<div style={{fontSize:".75em",color:"#c9a84c",letterSpacing:".15em",margin:"20px 0 12px"}}>■ 役職の違い</div>
{Object.entries(PLAYER_ROLES).map(([k,r])=>(
<div key={k} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #1a1a1a"}}>
<div style={{fontSize:"1.2em"}}>{r.icon}</div>
<div>
<div style={{color:r.color,fontSize:".85em",fontFamily:"'Cinzel',serif"}}>{r.label}</div>
<div style={{color:"#666",fontSize:".78em"}}>{r.goal}</div>
</div>
</div>
))}
<div style={{fontSize:".75em",color:"#c9a84c",letterSpacing:".15em",margin:"20px 0 12px"}}>■ 用語解説</div>
{[
{term:"心証ゲージ",color:"#facc15",desc:"裁判官がどちらを信じているかを0〜100で表します。70以上で無罪判決、20以下で有罪判決。毎ターン検察側に自動で少し傾くので、常に攻め続けることが重要です。"},
{term:"論理の穴",color:"#4ade80",desc:"相手の発言の矛盾を具体的に突いたとき発動します。「事実矛盾（+20）」「論理矛盾（+15）」「証拠矛盾（+10）」の3種類があり、4回発動すると相手が崩壊します。ふわっとした指摘では発動しません。"},
{term:"フェーズ",color:"#a78bfa",desc:"公判は「証拠の反論 → 被告人尋問 → 証人尋問 → 最終弁論」の順に進みます。各フェーズで戦略を変えることが重要です。心証が極端に傾くと途中で即時判決が下ります。"},
{term:"被告人尋問",color:"#e879f9",desc:"全難易度で必ず行われます。被告人は何かを隠しています。感情に訴えるか、矛盾を優しく指摘するかで、引き出せる証言が変わります。"},
{term:"証人尋問",color:"#e879f9",desc:"NORMAL以上では検察側証人が登場します。HARDでは証人が偽証する可能性があります。「いつ・どこで・誰と」を細かく問い詰めると矛盾が露わになります。"},
{term:"未開示証拠",color:"#f87171",desc:"NORMAL・HARDでは検察が弁護側に開示していない証拠を持っています。法廷で突然提示されることがあります。「その証拠は事前に開示されていない」と異議を申し立てることも有効です。"},
{term:"TRUE END",color:"#a78bfa",desc:"通常の無罪判決とは別に、特定の条件を満たすと真相解明エンドに到達できます。条件は自力で発見してください。事件ファイルのTRUE END進捗で達成度を確認できます。"},
].map((item,i)=>(
<div key={i} style={{padding:"10px 0",borderBottom:"1px solid #1a1a1a"}}>
<div style={{color:item.color,fontSize:".78em",fontFamily:"'Cinzel',serif",letterSpacing:".1em",marginBottom:4}}>{item.term}</div>
<div style={{color:"#888",fontSize:".82em",lineHeight:1.75}}>{item.desc}</div>
</div>
))}
<div style={{height:16}}/>
</div>
<div style={{padding:"12px 16px",paddingBottom:"max(12px,env(safe-area-inset-bottom))",background:"#0c0c13",borderTop:"1px solid #181818",flexShrink:0}}>
<button className="gb" onClick={()=>setScreen("role")}>役職を選ぶ</button>
</div>
</div>
);

// 役職選択
if (screen==="role") return wrap(
<div className="fi" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
<div style={{background:"#0c0c13",borderBottom:"1px solid #181818",padding:"12px 16px",flexShrink:0}}>
<div className="tg" style={{fontSize:".9em"}}>JUDGMENT CORE</div>
<div style={{fontSize:".6em",color:"#484848",marginTop:2}}>役職選択</div>
</div>
<div style={{flex:1,overflowY:"auto",padding:"20px 16px",WebkitOverflowScrolling:"touch"}}>
<div style={{fontSize:".7em",color:"#666",marginBottom:20,lineHeight:1.8}}>あなたが担当する役職を選んでください。</div>
<div style={{display:"flex",flexDirection:"column",gap:10}}>
{Object.entries(PLAYER_ROLES).map(([k,r])=>(
<div key={k} className={`rc ${playerRole===k?"sel":""}`} onClick={()=>setPlayerRole(k)}>
<div style={{display:"flex",gap:12,alignItems:"center"}}>
<div style={{fontSize:"1.8em",flexShrink:0}}>{r.icon}</div>
<div>
<div style={{color:r.color,fontFamily:"'Cinzel',serif",fontSize:".95em",marginBottom:4}}>{r.label}</div>
<div style={{fontSize:".82em",color:"#777",lineHeight:1.6}}>{r.goal}</div>
</div>
</div>
</div>
))}
</div>
</div>
<div style={{padding:"12px 16px",paddingBottom:"max(12px,env(safe-area-inset-bottom))",background:"#0c0c13",borderTop:"1px solid #181818",flexShrink:0,display:"flex",flexDirection:"column",gap:8}}>
<button className="gb" disabled={!playerRole} onClick={()=>setScreen("difficulty")}>次へ</button>
<button className="gho" onClick={()=>setScreen("rules")}>← 戻る</button>
</div>
</div>
);

// 難易度選択
if (screen==="difficulty") return wrap(
<div className="fi" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
<div style={{background:"#0c0c13",borderBottom:"1px solid #181818",padding:"12px 16px",flexShrink:0}}>
<div className="tg" style={{fontSize:".9em"}}>JUDGMENT CORE</div>
<div style={{fontSize:".6em",color:"#484848",marginTop:2}}>難易度選択</div>
</div>
<div style={{flex:1,overflowY:"auto",padding:"20px 16px",WebkitOverflowScrolling:"touch"}}>
<div style={{fontSize:".7em",color:"#666",marginBottom:20,lineHeight:1.8}}>難易度によって証拠開示数と検察の強さが変わります。</div>
<div style={{display:"flex",flexDirection:"column",gap:10}}>
{Object.entries(DIFF_INFO).map(([k,d])=>(
<div key={k} className={`dc ${difficulty===k?"sel":""}`} onClick={()=>setDifficulty(k)}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
<div style={{color:d.color,fontFamily:"'Cinzel',serif",fontSize:".95em",letterSpacing:".1em"}}>{d.label}</div>
<div style={{fontSize:".85em"}}>{d.star}</div>
</div>
<div style={{fontSize:".82em",color:"#777",lineHeight:1.6}}>{d.desc}</div>
<div style={{fontSize:".7em",color:"#484848",marginTop:5}}>証拠開示{d.evidenceOpen}個 / 証人{d.witnessCount}名</div>
</div>
))}
</div>
</div>
<div style={{padding:"12px 16px",paddingBottom:"max(12px,env(safe-area-inset-bottom))",background:"#0c0c13",borderTop:"1px solid #181818",flexShrink:0,display:"flex",flexDirection:"column",gap:8}}>
<button className="gb" disabled={!difficulty} onClick={()=>setScreen("scenario")}>次へ</button>
<button className="gho" onClick={()=>setScreen("role")}>← 戻る</button>
</div>
</div>
);

// シナリオ選択
if (screen==="scenario") return wrap(
<div className="fi" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
<div style={{background:"#0c0c13",borderBottom:"1px solid #181818",padding:"12px 16px",flexShrink:0}}>
<div className="tg" style={{fontSize:".9em"}}>JUDGMENT CORE</div>
<div style={{fontSize:".6em",color:"#484848",marginTop:2}}>シナリオ選択 — {DIFF_INFO[difficulty]?.label} / {PLAYER_ROLES[playerRole]?.label}</div>
</div>
<div style={{flex:1,overflowY:"auto",padding:"20px 16px",WebkitOverflowScrolling:"touch"}}>
<div style={{display:"flex",flexDirection:"column",gap:12}}>
{[
{k:"ai", icon:"🤖", color:"#c9a84c", title:"AI生成シナリオ", desc:"AIがランダムに事件を生成。毎回異なる謎に挑めます。"},
{k:"custom",icon:"📝",color:"#a78bfa", title:"持ち込みシナリオ", desc:"自作の事件設定や前作のログを入力して法廷で争います。"},
].map(({k,icon,color,title,desc})=>(
<div key={k} className={`dc ${scenarioType===k?"sel":""}`} onClick={()=>setScenarioType(k)}>
<div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
<div style={{fontSize:"1.6em",flexShrink:0}}>{icon}</div>
<div>
<div style={{color,fontFamily:"'Cinzel',serif",fontSize:".9em",marginBottom:5}}>{title}</div>
<div style={{fontSize:".82em",color:"#777",lineHeight:1.7}}>{desc}</div>
</div>
</div>
</div>
))}
</div>
{scenarioType==="custom" && (
<div className="fi" style={{marginTop:16}}>
<div style={{fontSize:".7em",color:"#666",marginBottom:8}}>事件の概要を入力してください</div>
<textarea value={customInput} onChange={e=>setCustomInput(e.target.value)}
placeholder="例：被告人・田中は同僚を殺害した疑いがある。当日は出張中だったと主張しているが…"
rows={5} style={{width:"100%",padding:"12px"}}/>
</div>
)}
{genError && <div style={{color:"#f87171",fontSize:".8em",marginTop:12,textAlign:"center"}}>{genError}</div>}
</div>
<div style={{padding:"12px 16px",paddingBottom:"max(12px,env(safe-area-inset-bottom))",background:"#0c0c13",borderTop:"1px solid #181818",flexShrink:0,display:"flex",flexDirection:"column",gap:8}}>
<button className="gb" disabled={!scenarioType||(scenarioType==="custom"&&!customInput.trim())}
onClick={()=>scenarioType==="ai"?generateScenario():startGame(null)}>開廷</button>
<button className="gho" onClick={()=>setScreen("difficulty")}>← 戻る</button>
</div>
</div>
);

// 生成中
if (screen==="generating") return wrap(
<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20,padding:24}}>
<div className="tg" style={{fontSize:"1.2em"}}>JUDGMENT CORE</div>
<div style={{display:"flex",gap:6,marginTop:8}}><span className="dot"/><span className="dot"/><span className="dot"/></div>
<div style={{color:"#484848",fontSize:".8em",letterSpacing:".1em"}}>事件を生成しています…</div>
</div>
);

// ══════════════════════════════════════════════════════
// ゲーム画面
// ══════════════════════════════════════════════════════
if (screen==="game" && gameState) {
const d = DIFF_INFO[gameState.difficulty];
const r = PLAYER_ROLES[gameState.playerRole];
const fs = gameState.finalScore;

// エンディング画面
if (gameState.gameOver && fs) {
const rankColor = fs.rank==="SS"||fs.rank==="S"?"#f0dfa0":fs.rank==="A"?"#4ade80":fs.rank==="B"?"#facc15":fs.rank==="C"?"#aaa":"#f87171";
const isTrueEnd = gameState.verdict==="TRUE_END";
const isWin = gameState.verdict==="無罪"||isTrueEnd;
return wrap(
<div className="fi" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
<div style={{background:"#0c0c13",borderBottom:"1px solid #181818",padding:"12px 16px",flexShrink:0}}>
<div className="tg" style={{fontSize:".9em"}}>JUDGMENT CORE</div>
<div style={{fontSize:".6em",color:"#484848",marginTop:2}}>{gameState.scenarioTitle} — 公判終了</div>
</div>
<div style={{flex:1,overflowY:"auto",padding:"20px 16px",WebkitOverflowScrolling:"touch"}}>
<div className={isTrueEnd?"vt":isWin?"vw":"vl"} style={{marginBottom:20}}>
<div style={{fontSize:"1.4em",marginBottom:4}}>
{isTrueEnd?"⭐ TRUE END — 真相解明":isWin?"無　罪":"有　罪"}
</div>
<div style={{fontSize:".7em",opacity:.7}}>{gameState.scenarioTitle}</div>
</div>
<div style={{background:"#0f0f0f",border:"1px solid #222",borderRadius:12,padding:"16px",marginBottom:16}}>
<div style={{textAlign:"center",marginBottom:16}}>
<div style={{fontSize:".6em",color:"#666",letterSpacing:".15em",marginBottom:6}}>FINAL RANK</div>
<div className="rank-badge" style={{color:rankColor}}>{fs.rank}</div>
<div style={{fontSize:".7em",color:"#666",marginTop:4}}>{fs.total.toLocaleString()} pts</div>
</div>
{[
["判決ボーナス", fs.baseScore],
["論理の穴×"+gameState.logicLeaks, fs.logicScore],
["効率ボーナス（"+fs.turns+"ターン）", fs.efficiencyScore],
isTrueEnd||gameState.trueEndProgress>0 ? ["TRUE END進捗", fs.trueEndScore] : null,
["難易度補正×"+fs.diffBonus, "×"+fs.diffBonus],
].filter(Boolean).map(([label,val],i)=>(
<div key={i} className="score-row">
<span style={{color:"#888"}}>{label}</span>
<span style={{color:"#c9a84c",fontFamily:"'Cinzel',serif"}}>{typeof val==="number"?val.toLocaleString():val}</span>
</div>
))}
</div>
{isTrueEnd && (
<div style={{background:"#0a0a1a",border:"1px solid #a78bfa44",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
<div style={{color:"#a78bfa",fontSize:".75em",letterSpacing:".1em",marginBottom:6}}>⭐ TRUE END 達成</div>
<div style={{color:"#888",fontSize:".82em",lineHeight:1.7}}>3つの隠し条件を全て満たし、事件の真相に辿り着きました。</div>
</div>
)}
{!isTrueEnd && gameState.trueEndProgress > 0 && (
<div style={{background:"#111",border:"1px dashed #333",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
<div style={{color:"#666",fontSize:".75em",letterSpacing:".1em",marginBottom:6}}>TRUE END 進捗 {gameState.trueEndProgress}/3</div>
<div style={{color:"#555",fontSize:".8em",lineHeight:1.7}}>あと少しで真相に辿り着けました。次回こそ全ての条件を満たしてみてください。</div>
</div>
)}
</div>
<div style={{padding:"12px 16px",paddingBottom:"max(12px,env(safe-area-inset-bottom))",background:"#0c0c13",borderTop:"1px solid #181818",flexShrink:0,display:"flex",flexDirection:"column",gap:8}}>
<button className="gb" onClick={()=>startGame(scenarioData)} style={{fontSize:".88em"}}>同じ事件で再公判</button>
<button className="gho" onClick={resetAll}>タイトルへ</button>
</div>
</div>
);
}

// ゲームプレイ画面
return wrap(
<>
{showPanel && (
<>
<div className="panel-overlay" onClick={()=>setShowPanel(false)}/>
<div className="panel">
<div style={{background:"#0c0c13",borderBottom:"1px solid #222",padding:"14px 16px",flexShrink:0,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div style={{color:"#c9a84c",fontFamily:"'Cinzel',serif",fontSize:".85em",letterSpacing:".1em"}}>事件ファイル</div>
<button onClick={()=>setShowPanel(false)} style={{background:"none",border:"none",color:"#666",fontSize:"1.2em",cursor:"pointer",padding:"0 4px"}}>✕</button>
</div>
<div style={{flex:1,overflowY:"auto",padding:"14px 16px",WebkitOverflowScrolling:"touch"}}>
<div style={{fontSize:".65em",color:"#c9a84c",letterSpacing:".12em",marginBottom:8}}>■ 事件概要</div>
<div style={{fontSize:".82em",color:"#888",lineHeight:1.8,marginBottom:16,background:"#0f0f0f",borderRadius:8,padding:"10px 12px"}}>
{gameState.scenarioText.split("\n").map((l,i)=><div key={i}>{l}</div>)}
</div>
<div style={{fontSize:".65em",color:"#4a9eff",letterSpacing:".12em",marginBottom:8}}>■ 開示済み証拠</div>
{gameState.evidenceOpen.map((e,i)=>(
<div key={i} style={{marginBottom:8}}>
<div style={{fontSize:".82em",color:"#c0d8f0",padding:"6px 10px",background:"#0d1e30",borderLeft:"2px solid #4a9eff",borderRadius:"0 6px 6px 0",fontWeight:"bold"}}>📄 {e}</div>
{gameState.evidenceDetails[i] && (
<div style={{fontSize:".78em",color:"#7a9ab8",padding:"6px 10px 6px 14px",background:"#081624",borderLeft:"2px solid #4a9eff44",borderRadius:"0 0 6px 0",lineHeight:1.7}}>{gameState.evidenceDetails[i]}</div>
)}
</div>
))}
{gameState.witnesses.length>0 && (<>
<div style={{fontSize:".65em",color:"#e879f9",letterSpacing:".12em",margin:"14px 0 8px"}}>■ 証人リスト</div>
{gameState.witnesses.map((w,i)=>(
<div key={i} style={{marginBottom:8}}>
<div style={{fontSize:".82em",color:"#ddb8f0",padding:"6px 10px",background:"#1a0e20",borderLeft:"2px solid #e879f9",borderRadius:"0 6px 6px 0",fontWeight:"bold"}}>👤 {w}</div>
{gameState.witnessDetails[i] && (
<div style={{fontSize:".78em",color:"#9a7ab8",padding:"6px 10px 6px 14px",background:"#120a18",borderLeft:"2px solid #e879f944",borderRadius:"0 0 6px 0",lineHeight:1.7}}>{gameState.witnessDetails[i]}</div>
)}
</div>
))}
</>)}
<div style={{fontSize:".65em",color:"#666",letterSpacing:".12em",margin:"14px 0 8px"}}>■ TRUE END 進捗</div>
{["条件①","条件②","条件③"].map((cond,i)=>(
<div key={i} style={{display:"flex",gap:8,alignItems:"center",padding:"5px 0",borderBottom:"1px solid #1a1a1a"}}>
<div style={{width:14,height:14,borderRadius:"50%",background:i<gameState.trueEndProgress?"#a78bfa":"#1a1a1a",border:`1px solid ${i<gameState.trueEndProgress?"#a78bfa88":"#333"}`,flexShrink:0}}/>
<div style={{fontSize:".78em",color:i<gameState.trueEndProgress?"#a78bfa":"#555"}}>{cond}</div>
</div>
))}
</div>
</div>
</>
)}

<div style={{background:"#0c0c13",borderBottom:"1px solid #181818",padding:"10px 14px 8px",flexShrink:0}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
<div>
<div className="tg" style={{fontSize:"1.0em"}}>JUDGMENT CORE</div>
<div style={{fontSize:".57em",color:"#484848",letterSpacing:".08em",marginTop:1}}>
{gameState.scenarioTitle} — {r.icon} {r.label}
</div>
</div>
<div style={{display:"flex",gap:6,alignItems:"center"}}>
<div style={{background:"#120e00",border:"1px solid #c9a84c2a",borderRadius:6,padding:"2px 8px",fontSize:".6em",color:d.color}}>{d.label}</div>
<div style={{background:"#120e00",border:"1px solid #c9a84c2a",borderRadius:6,padding:"2px 8px",fontSize:".6em",color:"#c9a84c",whiteSpace:"nowrap"}}>{PHASE_LABELS[gameState.phase]||gameState.phase}</div>
<button onClick={()=>setShowPanel(true)} style={{background:"#0f0f1a",border:"1px solid #2a2a3a",borderRadius:6,padding:"3px 8px",fontSize:".62em",color:"#888",cursor:"pointer",fontFamily:"'Noto Serif JP',serif"}}>📁</button>
</div>
</div>
<div style={{display:"flex",alignItems:"center",gap:12}}>
<div style={{flex:1,position:"relative"}}>
<div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
<span style={{fontSize:".58em",color:"#484848"}}>心証ゲージ</span>
<span style={{fontSize:".63em",color:gColor,fontWeight:"bold",position:"relative"}}>
{gLabel}
{scoreDelta!==null&&<span className="dp" style={{color:scoreDelta>=0?"#4ade80":"#f87171"}}>{scoreDelta>=0?`+${scoreDelta}`:scoreDelta}</span>}
</span>
</div>
<div style={{height:5,background:"#161616",borderRadius:3,border:"1px solid #1e1e1e",overflow:"hidden"}}>
<div className="gf" style={{height:"100%",width:`${gameState.score}%`,background:`linear-gradient(90deg,${gColor}55,${gColor})`,borderRadius:3}}/>
</div>
<div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
<span style={{fontSize:".5em",color:"#383838"}}>有罪</span>
<span style={{fontSize:".5em",color:"#383838"}}>無罪</span>
</div>
</div>
<div style={{textAlign:"center",flexShrink:0}}>
<div style={{fontSize:".53em",color:"#484848",marginBottom:4}}>論理の穴</div>
<div style={{display:"flex",gap:5}}>
{[0,1,2,3].map(i=>(
<div key={i} style={{width:10,height:10,borderRadius:"50%",background:i<gameState.logicLeaks?"#4ade80":"#161616",border:`1px solid ${i<gameState.logicLeaks?"#4ade8088":"#2a2a2a"}`,boxShadow:i<gameState.logicLeaks?"0 0 6px #4ade8055":"none",transition:"all .3s"}}/>
))}
</div>
</div>
</div>
</div>

<div style={{flex:1,overflowY:"auto",padding:"12px 12px 6px",display:"flex",flexDirection:"column",gap:9,WebkitOverflowScrolling:"touch"}}>
{gameState.messages.map((msg,i)=>{
if (msg.role==="phase_change") return (
<div key={i} className="psep">
<div style={{borderTop:"1px solid #1a1a1a",margin:"3px 0"}}/>
{msg.text}
<div style={{borderTop:"1px solid #1a1a1a",margin:"3px 0"}}/>
</div>
);
if (msg.role==="logic_leak") return <div key={i} className="blk" style={{fontSize:".88em"}}>{msg.text}</div>;
if (msg.role==="hint") return <div key={i} className="bhi">{msg.text}</div>;
if (msg.role==="verdict") return (
<div key={i} className={msg.verdict==="TRUE_END"?"vt":msg.verdict==="無罪"?"vw":"vl"}>
<div style={{fontSize:"1.25em",marginBottom:2}}>{msg.text}</div>
</div>
);
if (msg.role==="error") return <div key={i} style={{color:"#f87171",fontSize:".78em",textAlign:"center"}}>{msg.text}</div>;
const isPlayer = msg.role==="player";
const isJudge = msg.role==="judge";
const isSystem = msg.role==="system_open";
const isWitness= msg.role==="witness";
const sc = isPlayer?r.color:isJudge?"#a78bfa":isSystem?"#484848":isWitness?"#e879f9":"#f87171";
const bc = isPlayer?"bub bp":isJudge?"bub bj":isSystem?"bub bs":isWitness?"bub bw":"bub bpr";
return (
<div key={i} className={bc}>
{msg.speaker&&<div className="sl" style={{color:sc}}>{msg.speaker}{isWitness&&msg.isFalse&&<span style={{color:"#f87171",marginLeft:6,fontSize:".9em"}}>⚠️偽証の可能性</span>}</div>}
<div className="mt">{msg.text}</div>
</div>
);
})}
{loading&&(
<div style={{padding:"7px 13px",display:"flex",alignItems:"center",gap:8}}>
<span className="dot"/><span className="dot"/><span className="dot"/>
<span style={{color:"#3a3a3a",fontSize:".75em"}}>法廷が反応しています…</span>
</div>
)}
<div ref={messagesEndRef} style={{height:1}}/>
</div>

<div style={{borderTop:"1px solid #161616",padding:"10px 12px",paddingBottom:"max(10px,env(safe-area-inset-bottom))",background:"#0c0c13",flexShrink:0}}>
<div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
<textarea value={input} onChange={e=>setInput(e.target.value)}
onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleSubmit();}}}
placeholder={`${r.label}として発言…`} rows={2}
style={{flex:1,padding:"10px 12px"}} disabled={loading||gameState.gameOver}/>
<button className="sb" onClick={handleSubmit} disabled={loading||!input.trim()||gameState.gameOver}
style={{padding:"10px 14px",fontSize:".88em",minWidth:58,height:54,flexShrink:0}}>発言</button>
</div>
<div style={{marginTop:6,fontSize:".56em",color:"#2a2a2a",textAlign:"center"}}>
{d.label} {d.star} — {r.icon} {r.label}
</div>
</div>
</>
);
}

return null;
}
