const assetPathPrefix = "https://www.figma.com/api/mcp/asset/2954864d-0e72-4158-af7e-affcd24b166a";
const imgFrame = `${assetPathPrefix}/76592.svg`;
const imgFrame1 = `${assetPathPrefix}/379b3.svg`;
const imgEllipse = `${assetPathPrefix}/abbbe.svg`;
const imgFrame2 = `${assetPathPrefix}/9828f.svg`;
const imgFrame3 = `${assetPathPrefix}/63477.svg`;
const imgFrame4 = `${assetPathPrefix}/00fd3.svg`;
const imgFrame5 = `${assetPathPrefix}/8bcb6.svg`;
const imgFrame6 = `${assetPathPrefix}/75a18.svg`;

export default function TScreen() {
  return (
    <div className="bg-[#f9fafb] relative size-full" data-node-id="3:2" data-name="t-screen">
      <div className="absolute h-[44px] left-0 overflow-clip top-0 w-[375px]" data-node-id="3:3" data-name="status">
        <p className="[word-break:break-word] absolute font-['Inter:Semi_Bold'] font-semibold leading-[20px] left-[32px] not-italic text-[#101828] text-[15px] top-[14px] whitespace-nowrap" data-node-id="3:4">
          9:41
        </p>
        <div className="absolute border border-[rgba(16,24,40,0.35)] border-solid h-[12px] left-[327px] rounded-[3px] top-[17px] w-[24px]" data-node-id="3:5" data-name="Rectangle" />
        <div className="absolute bg-[#101828] h-[8px] left-[330px] rounded-[1.5px] top-[19px] w-[18px]" data-node-id="3:6" data-name="Rectangle" />
      </div>
      <div className="absolute content-stretch flex h-[44px] items-center justify-between left-0 overflow-clip px-[16px] top-[44px] w-[375px]" data-node-id="3:7" data-name="nav">
        <div className="relative shrink-0 size-[24px]" data-node-id="3:8" data-name="Frame">
          <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgFrame} />
        </div>
        <p className="[word-break:break-word] font-['Inter:Semi_Bold'] font-semibold leading-[22px] not-italic relative shrink-0 text-[#101828] text-[17px] whitespace-nowrap" data-node-id="3:10">
          Wallet
        </p>
        <div className="relative shrink-0 size-[24px]" data-node-id="3:11" data-name="Frame">
          <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgFrame1} />
        </div>
      </div>
      <div className="[word-break:break-word] absolute content-stretch flex flex-col gap-[6px] h-[172px] items-start left-[20px] not-italic overflow-clip p-[20px] rounded-[20px] shadow-[0px_12px_24px_-8px_rgba(83,56,158,0.3)] top-[104px] w-[335px] whitespace-nowrap" data-node-id="3:13" style={{ backgroundImage: "linear-gradient(152.82254694806906deg, rgb(83, 56, 158) 14.644%, rgb(127, 86, 217) 85.356%)" }} data-name="balance">
        <p className="font-['Inter:Medium'] font-medium leading-[20px] relative shrink-0 text-[#e9d7fe] text-[14px]" data-node-id="3:14">
          Total balance
        </p>
        <p className="font-['Inter:Semi_Bold'] font-semibold leading-[44px] relative shrink-0 text-[36px] text-white tracking-[-0.72px]" data-node-id="3:15">
          $12,480.20
        </p>
        <p className="font-['Inter:Medium'] font-medium leading-[20px] relative shrink-0 text-[#d6bbfb] text-[14px]" data-node-id="3:16">
          •••• 4821
        </p>
      </div>
      <div className="absolute content-stretch flex flex-col gap-[4px] items-start left-0 overflow-clip px-[20px] top-[300px] w-[375px]" data-node-id="3:17" data-name="recent">
        <p className="[word-break:break-word] font-['Inter:Semi_Bold'] font-semibold leading-[28px] not-italic relative shrink-0 text-[#101828] text-[18px] whitespace-nowrap" data-node-id="3:18">
          Recent
        </p>
        <div className="content-stretch flex gap-[12px] h-[64px] items-center overflow-clip relative shrink-0 w-[335px]" data-node-id="3:19" data-name="tx">
          <div className="relative shrink-0 size-[40px]" data-node-id="3:20" data-name="Ellipse">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgEllipse} />
          </div>
          <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[2px] items-start min-w-px not-italic overflow-clip relative whitespace-nowrap" data-node-id="3:21" data-name="col">
            <p className="font-['Inter:Medium'] font-medium leading-[24px] relative shrink-0 text-[#101828] text-[16px]" data-node-id="3:22">
              Coffee Lab
            </p>
            <p className="font-['Inter:Regular'] font-normal leading-[20px] relative shrink-0 text-[#667085] text-[14px]" data-node-id="3:23">
              Today, 9:12
            </p>
          </div>
          <p className="[word-break:break-word] font-['Inter:Semi_Bold'] font-semibold leading-[24px] not-italic relative shrink-0 text-[#101828] text-[16px] whitespace-nowrap" data-node-id="3:24">
            −$4.80
          </p>
        </div>
        <div className="content-stretch flex gap-[12px] h-[64px] items-center overflow-clip relative shrink-0 w-[335px]" data-node-id="3:25" data-name="tx">
          <div className="relative shrink-0 size-[40px]" data-node-id="3:26" data-name="Ellipse">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgEllipse} />
          </div>
          <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[2px] items-start min-w-px not-italic overflow-clip relative whitespace-nowrap" data-node-id="3:27" data-name="col">
            <p className="font-['Inter:Medium'] font-medium leading-[24px] relative shrink-0 text-[#101828] text-[16px]" data-node-id="3:28">
              Salary
            </p>
            <p className="font-['Inter:Regular'] font-normal leading-[20px] relative shrink-0 text-[#667085] text-[14px]" data-node-id="3:29">
              Yesterday
            </p>
          </div>
          <p className="[word-break:break-word] font-['Inter:Semi_Bold'] font-semibold leading-[24px] not-italic relative shrink-0 text-[#067647] text-[16px] whitespace-nowrap" data-node-id="3:30">
            +$3,200.00
          </p>
        </div>
        <div className="content-stretch flex gap-[12px] h-[64px] items-center overflow-clip relative shrink-0 w-[335px]" data-node-id="3:31" data-name="tx">
          <div className="relative shrink-0 size-[40px]" data-node-id="3:32" data-name="Ellipse">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgEllipse} />
          </div>
          <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[2px] items-start min-w-px not-italic overflow-clip relative whitespace-nowrap" data-node-id="3:33" data-name="col">
            <p className="font-['Inter:Medium'] font-medium leading-[24px] relative shrink-0 text-[#101828] text-[16px]" data-node-id="3:34">
              Metro card
            </p>
            <p className="font-['Inter:Regular'] font-normal leading-[20px] relative shrink-0 text-[#667085] text-[14px]" data-node-id="3:35">
              Mon, 18:40
            </p>
          </div>
          <p className="[word-break:break-word] font-['Inter:Semi_Bold'] font-semibold leading-[24px] not-italic relative shrink-0 text-[#101828] text-[16px] whitespace-nowrap" data-node-id="3:36">
            −$25.00
          </p>
        </div>
        <div className="content-stretch flex gap-[12px] h-[64px] items-center overflow-clip relative shrink-0 w-[335px]" data-node-id="3:37" data-name="tx">
          <div className="relative shrink-0 size-[40px]" data-node-id="3:38" data-name="Ellipse">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgEllipse} />
          </div>
          <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[2px] items-start min-w-px not-italic overflow-clip relative whitespace-nowrap" data-node-id="3:39" data-name="col">
            <p className="font-['Inter:Medium'] font-medium leading-[24px] relative shrink-0 text-[#101828] text-[16px]" data-node-id="3:40">
              Bookstore
            </p>
            <p className="font-['Inter:Regular'] font-normal leading-[20px] relative shrink-0 text-[#667085] text-[14px]" data-node-id="3:41">
              Sun, 13:05
            </p>
          </div>
          <p className="[word-break:break-word] font-['Inter:Semi_Bold'] font-semibold leading-[24px] not-italic relative shrink-0 text-[#101828] text-[16px] whitespace-nowrap" data-node-id="3:42">
            −$18.99
          </p>
        </div>
        <div className="content-stretch flex gap-[12px] h-[64px] items-center overflow-clip relative shrink-0 w-[335px]" data-node-id="3:43" data-name="tx">
          <div className="relative shrink-0 size-[40px]" data-node-id="3:44" data-name="Ellipse">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgEllipse} />
          </div>
          <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[2px] items-start min-w-px not-italic overflow-clip relative whitespace-nowrap" data-node-id="3:45" data-name="col">
            <p className="font-['Inter:Medium'] font-medium leading-[24px] relative shrink-0 text-[#101828] text-[16px]" data-node-id="3:46">
              Refund
            </p>
            <p className="font-['Inter:Regular'] font-normal leading-[20px] relative shrink-0 text-[#667085] text-[14px]" data-node-id="3:47">
              Sat, 10:22
            </p>
          </div>
          <p className="[word-break:break-word] font-['Inter:Semi_Bold'] font-semibold leading-[24px] not-italic relative shrink-0 text-[#067647] text-[16px] whitespace-nowrap" data-node-id="3:48">
            +$12.50
          </p>
        </div>
      </div>
      <div className="absolute backdrop-blur-[10px] bg-[rgba(255,255,255,0.92)] border-[#eaecf0] border-solid border-t content-stretch flex h-[83px] items-start justify-between left-0 overflow-clip pt-[8px] px-[12px] top-[729px] w-[375px]" data-node-id="3:49" data-name="tabbar">
        <div className="content-stretch flex flex-col gap-[2px] h-[49px] items-center overflow-clip relative shrink-0 w-[80px]" data-node-id="3:50" data-name="tab">
          <div className="relative shrink-0 size-[24px]" data-node-id="3:51" data-name="Frame">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgFrame2} />
          </div>
          <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[12px] not-italic relative shrink-0 text-[#7f56d9] text-[10px] whitespace-nowrap" data-node-id="3:53">
            Home
          </p>
        </div>
        <div className="content-stretch flex flex-col gap-[2px] h-[49px] items-center overflow-clip relative shrink-0 w-[80px]" data-node-id="3:54" data-name="tab">
          <div className="relative shrink-0 size-[24px]" data-node-id="3:55" data-name="Frame">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgFrame3} />
          </div>
          <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[12px] not-italic relative shrink-0 text-[#98a2b3] text-[10px] whitespace-nowrap" data-node-id="3:57">
            Cards
          </p>
        </div>
        <div className="content-stretch flex flex-col gap-[2px] h-[49px] items-center overflow-clip relative shrink-0 w-[80px]" data-node-id="3:58" data-name="tab">
          <div className="relative shrink-0 size-[24px]" data-node-id="3:59" data-name="Frame">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgFrame4} />
          </div>
          <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[12px] not-italic relative shrink-0 text-[#98a2b3] text-[10px] whitespace-nowrap" data-node-id="3:61">
            Stats
          </p>
        </div>
        <div className="content-stretch flex flex-col gap-[2px] h-[49px] items-center overflow-clip relative shrink-0 w-[80px]" data-node-id="3:62" data-name="tab">
          <div className="relative shrink-0 size-[24px]" data-node-id="3:63" data-name="Frame">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgFrame5} />
          </div>
          <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[12px] not-italic relative shrink-0 text-[#98a2b3] text-[10px] whitespace-nowrap" data-node-id="3:65">
            Profile
          </p>
        </div>
      </div>
      <div className="absolute bg-[#101828] h-[5px] left-[120.5px] rounded-[2.5px] top-[799px] w-[134px]" data-node-id="3:66" data-name="home-indicator" />
      <div className="absolute bg-[#7f56d9] left-[299px] overflow-clip rounded-[28px] shadow-[0px_8px_16px_-4px_rgba(16,24,40,0.18)] size-[56px] top-[657px]" data-node-id="3:67" data-name="fab">
        <div className="absolute left-[16px] size-[24px] top-[16px]" data-node-id="3:68" data-name="Frame">
          <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgFrame6} />
        </div>
      </div>
    </div>
  );
}
