import { deepClone } from '@/utils/other';
import type { GuidePayload } from '@/views/nodeMindMap/ts/medicineGuide';

/** 与 nodeEditor 表格「添加节点」一致；含空前后驱（仅表格行用，画布转 guide 时丢弃） */
export type MedicineOperateAddNodeSeed = GuidePayload & {
    prevNodeIDs: number[];
    nextNodeIDs: number[];
};

export interface MedicineOperateAddNodeTemplateItem {
    name: string;
    value: MedicineOperateAddNodeSeed;
}

export function medicineAddSeedToGuide(seed: MedicineOperateAddNodeSeed): GuidePayload {
    const { prevNodeIDs: _p, nextNodeIDs: _n, ...guide } = seed;
    return deepClone(guide) as GuidePayload;
}

/** 工单操作说明表格 / 节点思维导图共用 */
export const MEDICINE_OPERATE_ADD_NODE_TEMPLATES: MedicineOperateAddNodeTemplateItem[] =
    [
        {
            name: '空白节点',
            value: {
                operationDesc: '',
                operationTypes: [],
                targetDesc: '',
                targetDiagram: [],
                targetDiagramUrl: [],
                monitoringDesc: '',
                abnormalDesc: '',
                abnormalDiagram: [],
                abnormalDiagramUrl: [],
                prevNodeIDs: [],
                nextNodeIDs: []
            }
        },
        {
          name: '换镍钛方丝',
          value: {
              operationDesc:
                  '上/下颌放置0.0% × 0.0% 英寸镍钛方丝，所有牙位弓丝入槽。弓丝末端回弯。',
              operationTypes: ['3'],
              targetDesc: '上/下颌托槽无松动或脱落。',
              targetDiagram: [],
              targetDiagramUrl: [],
              monitoringDesc: '当复诊发现托槽脱落时，若在复诊前一周内脱落，则重新粘接托槽，按照操作指引进行下一步操作；若脱落时间超过一周，则重新粘接托槽，继续使用原弓丝。',
              abnormalDesc:
                '末端伸出颊面管挂颊侧粘膜：当牙齿逐渐排齐时，弓丝会从末端牙的颊面管伸出，可能会戳伤粘膜。如果患者有不适反应，可以及时复诊，用末端钳剪断伸出过长的弓丝。如果患者无法及时复诊，可以用让患者自己用粘膜保护蜡包裹伸出的弓丝，减轻不适感。',
              abnormalDiagram: [],
              abnormalDiagramUrl: [],
              prevNodeIDs: [],
              nextNodeIDs: []
          }
        },
        {
          name: '拉尖牙向远中',
          value: {
              operationDesc:
                  '用短距链状橡皮圈拉%向远中，分别挂在%托槽远中翼与%6颊面管上，长度为7个圈。',
              operationTypes: ['4'],
              targetDesc: '牙移动至参考位置。',
              targetDiagram: [],
              targetDiagramUrl: [],
              monitoringDesc:
                  '如果%已经到达图示位置，则取消链状橡皮圈牵引。若发生后牙支抗丢失，则植入种植钉支抗进行牵引。\n如果%没有到达图示位置，后牙支抗没有丢失，则更换链状橡皮圈，继续拉%远中。',
              abnormalDesc:
                  '支抗丢失：上/下颌后牙发生近移，从以下方面观察。\n上/下颌同象限拔牙间隙减少，且主要是磨牙近中移动导致，前磨牙远移较少，剩余间隙不足以排齐前牙',
              abnormalDiagram: [],
              abnormalDiagramUrl: [],
              prevNodeIDs: [],
              nextNodeIDs: []
          }
        },
        {
          name: '去釉',
          value: {
              operationDesc:
                  '%-%间邻面去釉%mm。（遵循少量多次原则。一次去釉＞0.2mm时，剩余部分后续复诊再去釉）。去釉后使用抛光条抛光并用棉棒为相应牙位涂氟保护剂。',
              operationTypes: [],
              targetDesc: '磨除量达到要求。',
              targetDiagram: [],
              targetDiagramUrl: [],
              monitoringDesc: '实施去釉前反复核对牙位和去釉量。操作中注意对牙龈和口腔黏膜的保护。此外去釉时需均匀磨除，避免出现台阶或倒凹。最后需抛光涂氟。',
              abnormalDesc: '砂条或车针划破粘膜。去釉力度过大，患者出现不适',
              abnormalDiagram: [],
              abnormalDiagramUrl: [],
              prevNodeIDs: [],
              nextNodeIDs: []
          }
        },
        {
          name: '推簧',
          value: {
              operationDesc:
                  '上/下颌放置0.016英寸不锈钢圆丝，%与%之间放置推簧，开辟间隙。推簧长度为“%与%托槽之间距离加%托槽宽度”。',
              operationTypes: ['5'],
              targetDesc: '获取适量间隙。',
              targetDiagram: [],
              targetDiagramUrl: [],
              monitoringDesc:
                  '推簧开辟%间隙足够，则停止推簧加力。\n如排齐%牙间隙不足,推簧继续加力。',
              abnormalDesc: '',
              abnormalDiagram: [],
              abnormalDiagramUrl: [],
              prevNodeIDs: [],
              nextNodeIDs: []
          }
        },
        {
          name: '推簧+辅弓',
          value: {
              operationDesc: '粘接%托槽。\n%放置辅弓排齐，在保留原弓丝的基础上增加0.012英寸镍钛圆丝作为辅弓。',
              operationTypes: ['2'],
              targetDesc: '牙移动至参考位置。',
              targetDiagram: [],
              targetDiagramUrl: [],
              monitoringDesc:
                  '如果%已经达到图示位置，则去除辅弓与推簧，将不锈钢丝更换为0.012英寸镍钛圆丝，全牙列入槽结扎。\n如果%未达到图示位置，则更换0.014英寸镍钛圆丝作为辅弓直至到达图示位置。',
              abnormalDesc: '',
              abnormalDiagram: [],
              abnormalDiagramUrl: [],
              prevNodeIDs: [],
              nextNodeIDs: []
          }
        },
        // {
        //     name: '扭转交互牵引',
        //     value: {
        //         operationDesc:
        //             '用短距链状橡皮圈连接%s(需要纠正的牙位）与%s(支抗牙位），长度为%s(橡皮链数量，暂定为4个）个圈。',
        //         operationTypes: ['5'],
        //         targetDesc: '牙齿扭转到位',
        //         targetDiagram: [],
        //         targetDiagramUrl: [],
        //         monitoringDesc:
        //             '1.如果到达图示位置，则取消链状橡皮圈牵引。 2.如果没有到达图示位置，则更换同样长度的链状橡皮圈，继续加力。',
        //         abnormalDesc: '',
        //         abnormalDiagram: [],
        //         abnormalDiagramUrl: [],
        //         prevNodeIDs: [],
        //         nextNodeIDs: []
        //     }
        // },
        {
          name: '锁合交互牵引',
          value: {
              operationDesc:
                  '在%牙位的%s唇侧/舌侧/特殊位置粘接舌侧扣，XXXX（%s拉%s牙位向近中/远中移动，%s纠正%牙位的扭转，交互牵引%s纠正%牙位的%s反合/锁合，%/s牙使用1/4英寸，3.5盎司皮筋牵引，分别挂在牵引钩和舌侧扣上。每天更换1次橡皮筋。',
              operationTypes: [],
              targetDesc: '牙移动至参考位置。',
              targetDiagram: [],
              targetDiagramUrl: [],
              monitoringDesc:
                  '如果锁合纠正后,则停止挂交互牵引。\n如果锁合未纠正，则继续交互牵引，同时确保后牙无咬合干扰。',
              abnormalDesc: '',
              abnormalDiagram: [],
              abnormalDiagramUrl: [],
              prevNodeIDs: [],
              nextNodeIDs: []
          }
      },
        // {
        //     name: '舌侧扣',
        //     value: {
        //         operationDesc:
        //             '在%s牙位的%s唇侧/舌侧/特殊位置粘接舌侧扣，XXXX（%s拉%s牙位向近中/远中移动，%s纠正%牙位的扭转，交互牵引%s纠正%牙位的%s反合/锁合',
        //         operationTypes: [],
        //         targetDesc: '',
        //         targetDiagram: [],
        //         targetDiagramUrl: [],
        //         monitoringDesc: '',
        //         abnormalDesc: '',
        //         abnormalDiagram: [],
        //         abnormalDiagramUrl: [],
        //         prevNodeIDs: [],
        //         nextNodeIDs: []
        //     }
        // },
        // {
        //     name: '悬吊拉钩',
        //     value: {
        //         operationDesc:
        //             '在%s牙位的舌侧粘接矫治器，用短距链状橡皮圈，从XXXX（%s牙位）颊面管拉钩，绕过禾面，挂到腭侧的拉钩，长度为（%s几个圈，暂定为6个圈）',
        //         operationTypes: ['5'],
        //         targetDesc: '牙齿移动到位',
        //         targetDiagram: [],
        //         targetDiagramUrl: [],
        //         monitoringDesc:
        //             '会分为两种情况： 一种是弓丝可以入槽，输出：1.如果到达图示位置，则取消链状橡皮圈牵引。 另一种是弓丝没有入槽，输出： 2.如果到达图示位置，则取消链状橡皮圈牵引。弓丝入槽。',
        //         abnormalDesc:
        //             '异常情况监控： 在牙齿移动过程中，可能会出现后牙垂直向高度增加，暂时不用特殊处理，再后续矫治过程中会进行压低。',
        //         abnormalDiagram: [],
        //         abnormalDiagramUrl: [],
        //         prevNodeIDs: [],
        //         nextNodeIDs: []
        //     }
        // },
        {
          name: '悬吊结扎',
          value: {
              operationDesc:
                  '%悬吊结扎',
              operationTypes: ['1'],
              targetDesc: '牙移动至参考位置。',
              targetDiagram: [],
              targetDiagramUrl: [],
              monitoringDesc:
                  '如果%s到达图示位置，则取消悬吊，弓丝入槽。\n如果%s未到达图示位置，则继续悬吊结扎。',
              abnormalDesc:
                  '',
              abnormalDiagram: [],
              abnormalDiagramUrl: [],
              prevNodeIDs: [],
              nextNodeIDs: []
          }
      }
    ];
